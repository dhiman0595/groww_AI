const path = require("node:path");
const fs = require("node:fs");
const pdfParse = require("pdf-parse");
const express = require("express");
const cors = require("cors");
const { MOCK_SOURCE_FIXTURES } = require("./mock/rawFixtures.cjs");
const { fetchNseDocuments } = require("./adapters/nseAdapter.cjs");
const { fetchBseDocuments } = require("./adapters/bseAdapter.cjs");
const { fetchSebiDocuments } = require("./adapters/sebiAdapter.cjs");
const {
  fetchFilingsFeedDocuments,
  hasFilingsFeedConfig,
  normalizeRequestedType,
} = require("./adapters/filingsFeedAdapter.cjs");
const {
  inferDocumentType,
  inferPublishedAt,
  inferSearchText,
  inferSymbol,
  matchesDocType,
  sortRawDocuments,
  withinDateRange,
} = require("./utils/documentHelpers.cjs");
const { fetchCompaniesFromMaster, hasMasterDatabase } = require("./db/companiesMaster.cjs");
const {
  alignEmbeddingDimension,
  ensureRagSchema,
  findIndexedDocIds,
  hasRagDatabase,
  searchRagChunks,
  searchRagChunksByKeywords,
  upsertRagChunks,
} = require("./db/ragStore.cjs");

const PORT = Number(process.env.PORT || 8787);
const XAI_API_KEY = `${process.env.XAI_API_KEY || ""}`.trim();
const XAI_MODEL = `${process.env.XAI_MODEL || "grok-3-mini"}`.trim();
const XAI_EMBEDDING_MODEL = `${process.env.XAI_EMBEDDING_MODEL || ""}`.trim();
const DIST_DIR = path.resolve(__dirname, "..", "dist");
const DIST_INDEX_FILE = path.join(DIST_DIR, "index.html");
const HAS_DIST = fs.existsSync(DIST_INDEX_FILE);
const app = express();

const SUMMARY_REGEX = /\b(summary|summarize|deep analysis|analysis|overview|digest)\b/i;
const PDF_TEXT_FETCH_TIMEOUT_MS = 12000;
const PDF_TEXT_MAX_BYTES = 12 * 1024 * 1024;
const PDF_TEXT_MAX_CHARS = 45000;
const PDF_TEXT_PAGE_LIMIT = 8;
const RAG_INGEST_PRELOAD_LIMIT = Math.max(1, Math.min(Number(process.env.RAG_INGEST_PRELOAD_LIMIT || 6), 12));
const RAG_MAX_CHUNKS_PER_DOC = Math.max(3, Math.min(Number(process.env.RAG_MAX_CHUNKS_PER_DOC || 16), 30));
const RAG_CHUNK_CHAR_SIZE = Math.max(500, Math.min(Number(process.env.RAG_CHUNK_CHAR_SIZE || 1200), 2200));
const RAG_CHUNK_OVERLAP = Math.max(50, Math.min(Number(process.env.RAG_CHUNK_OVERLAP || 180), 600));
const RAG_RETRIEVAL_LIMIT = Math.max(2, Math.min(Number(process.env.RAG_RETRIEVAL_LIMIT || 8), 20));
const RAG_EMBEDDING_INPUT_CHARS = Math.max(200, Math.min(Number(process.env.RAG_EMBEDDING_INPUT_CHARS || 2400), 5000));
const pdfTextCache = new Map();
const ragIngestionInFlight = new Set();

app.use(cors());
app.use(express.json());

if (hasRagDatabase() && XAI_API_KEY) {
  void ensureRagSchema();
}

function toInternalDocTypeFilter(rawValue) {
  const raw = `${rawValue || "ALL"}`.trim();
  if (!raw || raw.toUpperCase() === "ALL") {
    return "ALL";
  }

  const lower = raw.toLowerCase();
  if (lower === "quarterly-result") return "QUARTERLY_RESULT";
  if (lower === "announcement") return "ANNOUNCEMENT";
  if (lower === "earnings-transcript") return "CONCALL_TRANSCRIPT";
  if (lower === "investor-presentation") return "INVESTOR_PRESENTATION";
  if (lower === "annual-report") return "OTHER";

  return raw.toUpperCase();
}

async function loadRawDocuments(symbol, options = {}) {
  const normalizedSymbol = `${symbol || ""}`.trim().toUpperCase();
  const requestedType = normalizeRequestedType(options.documentType || "ALL");

  if (normalizedSymbol) {
    const filingsFeedDocuments = await fetchFilingsFeedDocuments({
      symbol: normalizedSymbol,
      documentType: requestedType,
    });

    if (filingsFeedDocuments.length > 0 || hasFilingsFeedConfig()) {
      return filingsFeedDocuments;
    }
  }

  const [nseLive, bseLive, sebiLive] = await Promise.all([
    fetchNseDocuments(normalizedSymbol),
    fetchBseDocuments(normalizedSymbol),
    fetchSebiDocuments(normalizedSymbol),
  ]);

  const nse = nseLive.length > 0 ? nseLive : MOCK_SOURCE_FIXTURES.nse;
  const bse = bseLive.length > 0 ? bseLive : MOCK_SOURCE_FIXTURES.bse;
  const sebi = sebiLive.length > 0 ? sebiLive : MOCK_SOURCE_FIXTURES.sebi;

  return [...nse, ...bse, ...sebi];
}

function inferTitle(raw) {
  if (raw.provider === "NSE") return raw.headline || "NSE filing";
  if (raw.provider === "BSE") return raw.subject || "BSE disclosure";
  if (raw.provider === "SEBI") return `${raw.document_kind || "SEBI"} filing`;
  return "Document";
}

function inferDescription(raw) {
  if (raw.provider === "NSE") return raw.details || "";
  if (raw.provider === "BSE") return raw.note || "";
  if (raw.provider === "SEBI") return raw.summary || "";
  return "";
}

function inferQuarter(raw) {
  if (raw.provider === "NSE") return raw.quarter || "";
  if (raw.provider === "BSE") return raw.quarter || "";
  return "";
}

function inferFiscalYear(raw) {
  if (raw.provider === "NSE") return raw.fiscal_year || "";
  if (raw.provider === "BSE") return raw.fiscal_year || "";
  return "";
}

function inferCompanyName(raw) {
  if (raw.provider === "NSE") return raw.company_name || raw.symbol || "Unknown company";
  if (raw.provider === "BSE") return raw.company || raw.symbol || "Unknown company";
  if (raw.provider === "SEBI") return raw.issuer_name || raw.symbol || "Unknown company";
  return raw.symbol || "Unknown company";
}

function inferSourceName(raw) {
  if (raw.provider === "NSE") return "NSE corporate filings";
  if (raw.provider === "BSE") return "BSE corporate disclosures";
  if (raw.provider === "SEBI") return "SEBI filings";
  return "Public filing";
}

function inferSourceUrl(raw) {
  if (raw.provider === "NSE") return raw.page_url || raw.file_url || "";
  if (raw.provider === "BSE") return raw.link || raw.attachment || "";
  if (raw.provider === "SEBI") return raw.page_url || raw.pdf_url || "";
  return "";
}

function inferFileUrl(raw) {
  if (raw.provider === "NSE") return raw.file_url || "";
  if (raw.provider === "BSE") return raw.attachment || "";
  if (raw.provider === "SEBI") return raw.pdf_url || "";
  return "";
}

function stableHash(seed) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0).toString(16);
}

function inferNormalizedId(raw) {
  if (raw.provider === "NSE") {
    return `doc_${stableHash(`${raw.provider}-${raw.filing_id}-${raw.symbol}-${raw.published_at}`)}`;
  }

  if (raw.provider === "BSE") {
    return `doc_${stableHash(`${raw.provider}-${raw.notice_id}-${raw.symbol}-${raw.posted_at}`)}`;
  }

  if (raw.provider === "SEBI") {
    return `doc_${stableHash(`${raw.provider}-${raw.filing_no}-${raw.symbol}-${raw.filed_on}`)}`;
  }

  return `doc_${stableHash(JSON.stringify(raw))}`;
}

function normalizeYearLabel(value) {
  return `${value || ""}`.trim().toUpperCase();
}

function normalizeChatDocument(raw) {
  const title = inferTitle(raw);
  const description = inferDescription(raw);
  const quarter = inferQuarter(raw);
  const fiscalYear = inferFiscalYear(raw);
  const publishedAt = inferPublishedAt(raw);
  const sourceUrl = inferSourceUrl(raw);
  const fileUrl = inferFileUrl(raw);

  return {
    id: inferNormalizedId(raw),
    symbol: inferSymbol(raw),
    company_name: inferCompanyName(raw),
    title,
    description,
    quarter,
    fiscal_year: fiscalYear,
    published_at: publishedAt,
    doc_type: inferDocumentType(raw),
    source_name: inferSourceName(raw),
    source_url: sourceUrl,
    file_url: fileUrl,
    search_blob: `${title} ${description} ${inferSearchText(raw)}`.toLowerCase(),
  };
}

function extractFiscalYearScore(value) {
  const match = `${value || ""}`.match(/FY\s*(\d{2,4})/i);
  if (!match?.[1]) {
    return null;
  }

  let year = Number(match[1]);
  if (!Number.isFinite(year)) {
    return null;
  }
  if (year < 100) {
    year += 2000;
  }
  return year;
}

function matchesYearFilter(document, yearFilter) {
  if (!yearFilter) {
    return true;
  }

  const normalizedFilter = normalizeYearLabel(yearFilter);
  if (!normalizedFilter || normalizedFilter === "ALL") {
    return true;
  }

  const normalizedFiscalYear = normalizeYearLabel(document.fiscal_year);
  if (normalizedFiscalYear && normalizedFiscalYear.includes(normalizedFilter)) {
    return true;
  }

  const fiscalScore = extractFiscalYearScore(normalizedFilter);
  const documentFiscalScore = extractFiscalYearScore(normalizedFiscalYear);
  if (fiscalScore && documentFiscalScore && fiscalScore === documentFiscalScore) {
    return true;
  }

  const published = new Date(document.published_at);
  if (!Number.isNaN(published.getTime())) {
    const publishedYear = `${published.getFullYear()}`;
    if (normalizedFilter.includes(publishedYear) || publishedYear.includes(normalizedFilter)) {
      return true;
    }
  }

  return false;
}

function tokenize(text) {
  return `${text || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function scoreDocument(document, options) {
  const {
    keywords,
    selectedQuarter,
    selectedManagementTopic,
    selectedFilingTopic,
    isSummaryRequest,
  } = options;

  let score = 0;

  for (const keyword of keywords) {
    if (document.search_blob.includes(keyword)) {
      score += 2;
    }
  }

  if (keywords.length === 0) {
    score += 1;
  }

  if (selectedQuarter && document.doc_type === "QUARTERLY_RESULT") {
    const quarter = normalizeYearLabel(document.quarter);
    if (quarter === selectedQuarter) {
      score += 7;
    } else if (quarter.length > 0) {
      score -= 1;
    }
  }

  if (selectedManagementTopic && document.title.toLowerCase().includes(selectedManagementTopic)) {
    score += 5;
  }

  if (selectedFilingTopic && document.title.toLowerCase().includes(selectedFilingTopic)) {
    score += 5;
  }

  if (document.doc_type === "QUARTERLY_RESULT") {
    score += 1;
  }

  if (document.doc_type === "CONCALL_TRANSCRIPT" || document.doc_type === "ANNOUNCEMENT") {
    score += 1;
  }

  if (isSummaryRequest && (document.doc_type === "DRHP" || document.doc_type === "RHP" || document.doc_type === "OFFER_DOCUMENT")) {
    score += 1;
  }

  return score;
}

function rankDocuments(documents, options) {
  return [...documents]
    .map((document) => ({
      document,
      score: scoreDocument(document, options),
    }))
    .sort((left, right) => {
      const scoreDiff = right.score - left.score;
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      const leftParsed = new Date(left.document.published_at).getTime();
      const rightParsed = new Date(right.document.published_at).getTime();
      const leftTs = Number.isFinite(leftParsed) ? leftParsed : 0;
      const rightTs = Number.isFinite(rightParsed) ? rightParsed : 0;
      return rightTs - leftTs;
    })
    .map((item) => item.document);
}

function uniqueSources(documents, limit = 8) {
  const map = new Map();

  for (const document of documents) {
    const key = `${document.title}-${document.source_url || document.file_url || ""}`;
    if (map.has(key)) {
      continue;
    }

    map.set(key, {
      title: document.title,
      url: document.source_url || document.file_url || "",
      source_name: document.source_name,
      published_at: document.published_at,
    });

    if (map.size >= limit) {
      break;
    }
  }

  return Array.from(map.values());
}

function summarizeDocumentLine(document) {
  const quarterPart = document.quarter ? ` | ${document.quarter}` : "";
  const yearPart = document.fiscal_year ? ` | ${document.fiscal_year}` : "";
  const description = document.description ? ` | ${document.description}` : "";
  return `${document.title} (${document.doc_type}${quarterPart}${yearPart})${description}`;
}

function normalizeWhitespace(value) {
  return `${value || ""}`.replace(/\s+/g, " ").trim();
}

function hasMeaningfulDescription(document) {
  const normalized = normalizeWhitespace(document?.description);
  if (!normalized) {
    return false;
  }

  const lower = normalized.toLowerCase();
  if (/^no summary available\.?$/.test(lower) || /^summary not available\.?$/.test(lower)) {
    return false;
  }
  if (/^(not available|n\/a|na|none|null|nil)$/i.test(lower)) {
    return false;
  }
  if (/^[-.]+$/.test(lower)) {
    return false;
  }

  return true;
}

function looksLikePdfUrl(url) {
  const normalized = `${url || ""}`.toLowerCase();
  return (
    normalized.includes(".pdf") ||
    normalized.includes("annpdfopen") ||
    normalized.includes("/announcements/") ||
    normalized.includes("s3.amazonaws.com")
  );
}

async function fetchPdfText(url) {
  if (!url || !looksLikePdfUrl(url)) {
    return "";
  }

  if (pdfTextCache.has(url)) {
    return pdfTextCache.get(url);
  }

  const pending = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PDF_TEXT_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/pdf,*/*",
          "User-Agent": "Groww-AI/1.0 (+https://groww-ai.onrender.com)",
          Referer: "https://www.bseindia.com/",
        },
      });

      if (!response.ok) {
        return "";
      }

      const bytes = Number(response.headers.get("content-length") || 0);
      if (bytes > PDF_TEXT_MAX_BYTES) {
        return "";
      }

      const contentType = `${response.headers.get("content-type") || ""}`.toLowerCase();
      if (!contentType.includes("pdf") && !looksLikePdfUrl(url)) {
        return "";
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer || buffer.length === 0 || buffer.length > PDF_TEXT_MAX_BYTES) {
        return "";
      }

      const parsed = await pdfParse(buffer, {
        max: PDF_TEXT_PAGE_LIMIT,
      });

      const text = normalizeWhitespace(parsed?.text || "");
      return text.slice(0, PDF_TEXT_MAX_CHARS);
    } catch {
      return "";
    } finally {
      clearTimeout(timeout);
    }
  })();

  pdfTextCache.set(url, pending);
  return pending;
}

async function enrichDocumentsWithPdfText(documents) {
  return Promise.all(
    documents.map(async (document) => {
      if (!document || hasMeaningfulDescription(document)) {
        return document;
      }

      const pdfUrl = document.file_url || document.source_url;
      const ragText = await fetchPdfText(pdfUrl);
      if (!ragText) {
        return document;
      }

      return {
        ...document,
        rag_excerpt: ragText,
        description: ragText.slice(0, 420),
      };
    })
  );
}

function estimateTokenCount(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return 0;
  }
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function splitTextIntoRagChunks(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return [];
  }

  const chunks = [];
  let start = 0;

  while (start < normalized.length && chunks.length < RAG_MAX_CHUNKS_PER_DOC) {
    const hardEnd = Math.min(normalized.length, start + RAG_CHUNK_CHAR_SIZE);
    let end = hardEnd;

    if (hardEnd < normalized.length) {
      const lastSpaceIndex = normalized.lastIndexOf(" ", hardEnd);
      if (lastSpaceIndex > start + 220) {
        end = lastSpaceIndex;
      }
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk.length >= 80) {
      chunks.push(chunk);
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(end - RAG_CHUNK_OVERLAP, start + 1);
  }

  return chunks;
}

function createRagChunkId(document, chunkIndex, chunkText) {
  return `chunk_${stableHash(
    `${document.id}|${document.symbol}|${chunkIndex}|${chunkText.slice(0, 120)}|${document.published_at || ""}`
  )}`;
}

async function requestXaiEmbedding(text, _taskType) {
  if (!XAI_API_KEY || !XAI_EMBEDDING_MODEL) {
    return [];
  }

  const prompt = `${text || ""}`.trim();
  if (!prompt) {
    return [];
  }

  const endpoint = "https://api.x.ai/v1/embeddings";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: XAI_EMBEDDING_MODEL,
      input: prompt.slice(0, RAG_EMBEDDING_INPUT_CHARS),
    }),
  });

  if (!response.ok) {
    const reason = await response.text().catch(() => "");
    throw new Error(`Embedding request failed (${response.status}): ${reason.slice(0, 180)}`);
  }

  const data = await response.json();
  const values = Array.isArray(data?.data?.[0]?.embedding) ? data.data[0].embedding : [];

  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  return alignEmbeddingDimension(values);
}

async function ingestDocumentIntoRag(document) {
  if (!document || !hasRagDatabase()) {
    return 0;
  }

  const schemaReady = await ensureRagSchema();
  if (!schemaReady) {
    return 0;
  }

  const pdfUrl = document.file_url || document.source_url;
  const fullText = await fetchPdfText(pdfUrl);
  const fallbackText = hasMeaningfulDescription(document) ? document.description : "";
  const content = normalizeWhitespace(fullText || fallbackText);
  if (!content) {
    return 0;
  }

  const chunks = splitTextIntoRagChunks(content);
  if (chunks.length === 0) {
    return 0;
  }

  const rows = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunkText = chunks[index];
    let embedding = [];
    if (XAI_EMBEDDING_MODEL && XAI_API_KEY) {
      try {
        embedding = await requestXaiEmbedding(chunkText, "RETRIEVAL_DOCUMENT");
      } catch (error) {
        console.error("Chunk embedding failed:", error.message);
      }
    }
    if (!Array.isArray(embedding) || embedding.length === 0) {
      embedding = alignEmbeddingDimension([]);
    }

    rows.push({
      chunk_id: createRagChunkId(document, index, chunkText),
      doc_id: document.id,
      symbol: document.symbol,
      company_name: document.company_name,
      doc_type: document.doc_type,
      title: document.title,
      quarter: document.quarter,
      fiscal_year: document.fiscal_year,
      published_at: document.published_at,
      source_name: document.source_name,
      source_url: document.source_url,
      file_url: document.file_url,
      chunk_index: index,
      chunk_text: chunkText,
      chunk_tokens: estimateTokenCount(chunkText),
      embedding,
    });
  }

  if (rows.length === 0) {
    return 0;
  }

  return upsertRagChunks(rows);
}

function queueRagIngestion(document) {
  if (!document?.id || ragIngestionInFlight.has(document.id)) {
    return;
  }

  ragIngestionInFlight.add(document.id);
  setTimeout(() => {
    void ingestDocumentIntoRag(document)
      .catch((error) => {
        console.error(`RAG ingestion failed for ${document.id}:`, error.message);
      })
      .finally(() => {
        ragIngestionInFlight.delete(document.id);
      });
  }, 0);
}

async function ensureRagCoverage(documents, options = {}) {
  if (!hasRagDatabase() || !XAI_API_KEY) {
    return;
  }

  const safeDocuments = Array.isArray(documents) ? documents.filter((document) => Boolean(document?.id)) : [];
  if (safeDocuments.length === 0) {
    return;
  }

  const schemaReady = await ensureRagSchema();
  if (!schemaReady) {
    return;
  }

  const docIds = safeDocuments.map((document) => document.id);
  const indexedDocIds = await findIndexedDocIds(docIds);
  const missingDocuments = safeDocuments.filter((document) => !indexedDocIds.has(document.id));
  if (missingDocuments.length === 0) {
    return;
  }

  const blockingCount = Math.max(0, Math.min(Number(options.blockingCount) || 0, missingDocuments.length));
  const blockingDocuments = missingDocuments.slice(0, blockingCount);
  for (const document of blockingDocuments) {
    try {
      await ingestDocumentIntoRag(document);
    } catch (error) {
      console.error(`RAG blocking ingestion failed for ${document.id}:`, error.message);
    }
  }

  const backgroundCandidates = missingDocuments.slice(blockingCount, RAG_INGEST_PRELOAD_LIMIT);
  for (const document of backgroundCandidates) {
    queueRagIngestion(document);
  }
}

async function retrieveRagChunksForQuestion(options = {}) {
  const symbol = `${options.symbol || ""}`.trim().toUpperCase();
  const question = `${options.question || ""}`.trim();
  const year = `${options.year || ""}`.trim();
  const docIds = Array.isArray(options.docIds)
    ? options.docIds.map((value) => `${value || ""}`.trim()).filter((value) => value.length > 0)
    : [];
  const limit = Math.max(2, Math.min(Number(options.limit) || RAG_RETRIEVAL_LIMIT, 20));

  if (!symbol || !question || !hasRagDatabase() || !XAI_API_KEY) {
    return [];
  }

  const schemaReady = await ensureRagSchema();
  if (!schemaReady) {
    return [];
  }

  if (XAI_EMBEDDING_MODEL) {
    let queryEmbedding;
    try {
      queryEmbedding = await requestXaiEmbedding(question, "RETRIEVAL_QUERY");
    } catch (error) {
      console.error("Query embedding failed:", error.message);
    }

    if (Array.isArray(queryEmbedding) && queryEmbedding.length > 0) {
      try {
        return await searchRagChunks({
          symbol,
          embedding: queryEmbedding,
          docIds,
          year,
          limit,
        });
      } catch (error) {
        console.error("RAG vector retrieval failed:", error.message);
      }
    }
  }

  try {
    return await searchRagChunksByKeywords({
      symbol,
      query: question,
      docIds,
      year,
      limit,
    });
  } catch (error) {
    console.error("RAG lexical retrieval failed:", error.message);
    return [];
  }
}

function buildChunkContextLines(chunks) {
  return chunks.map((chunk, index) => {
    const relevance = Number.isFinite(chunk.similarity) ? Math.max(0, Math.min(chunk.similarity, 1)) : 0;
    return [
      `[C${index + 1}] ${chunk.title} (chunk ${Number(chunk.chunk_index) + 1}, relevance ${relevance.toFixed(2)})`,
      `Type: ${chunk.doc_type || "n/a"}`,
      `Quarter: ${chunk.quarter || "n/a"}`,
      `Fiscal year: ${chunk.fiscal_year || "n/a"}`,
      `Source: ${chunk.source_name || "Public filing"}`,
      `Snippet: ${normalizeWhitespace(chunk.chunk_text).slice(0, 900)}`,
    ].join("\n");
  });
}

function buildChunkSources(chunks, limit = 8) {
  const map = new Map();

  for (const chunk of chunks) {
    const key = `${chunk.doc_id}:${chunk.chunk_index}`;
    if (map.has(key)) {
      continue;
    }

    map.set(key, {
      title: `${chunk.title} [chunk ${Number(chunk.chunk_index) + 1}]`,
      url: chunk.source_url || chunk.file_url || "",
      source_name: chunk.source_name || "Filing chunk",
      published_at: chunk.published_at || "",
    });

    if (map.size >= limit) {
      break;
    }
  }

  return Array.from(map.values());
}

function mergeUniqueSources(primary, secondary, limit = 8) {
  const map = new Map();

  for (const source of [...primary, ...secondary]) {
    const key = `${source.title || ""}|${source.url || ""}|${source.source_name || ""}`;
    if (map.has(key)) {
      continue;
    }
    map.set(key, source);
    if (map.size >= limit) {
      break;
    }
  }

  return Array.from(map.values());
}

function deriveConfidenceMeta({ ragChunks, documents }) {
  const chunkCount = Array.isArray(ragChunks) ? ragChunks.length : 0;
  const docCount = Array.isArray(documents) ? documents.length : 0;

  if (chunkCount >= 5) {
    return {
      confidence_label: "high",
      confidence_reason: `Answer grounded in ${chunkCount} retrieved filing chunks across ${docCount} documents.`,
    };
  }

  if (chunkCount >= 2) {
    return {
      confidence_label: "medium",
      confidence_reason: `Answer grounded in ${chunkCount} filing chunks; evidence coverage is moderate.`,
    };
  }

  return {
    confidence_label: "low",
    confidence_reason: "Limited chunk-level evidence was available; answer relied on high-level filing snippets.",
  };
}

function extractMetricSignals(documents) {
  const signals = [];

  for (const document of documents) {
    const text = `${document.title} ${document.description}`.toLowerCase();
    const numberMatches = text.match(/-?\d+(?:,\d{3})*(?:\.\d+)?/g);

    if (!numberMatches || numberMatches.length === 0) {
      continue;
    }

    if (text.includes("revenue")) {
      signals.push(`Revenue references found in "${document.title}" (${numberMatches.slice(0, 2).join(", ")}).`);
    }

    if (text.includes("pat") || text.includes("profit")) {
      signals.push(`Profit/PAT references found in "${document.title}" (${numberMatches.slice(0, 2).join(", ")}).`);
    }

    if (text.includes("margin")) {
      signals.push(`Margin commentary appears in "${document.title}".`);
    }

    if (signals.length >= 5) {
      break;
    }
  }

  return signals;
}

function buildDefaultAnswer({ companyName, symbol, question, documents }) {
  const scopeSummary = documents.slice(0, 4).map((document, index) => `${index + 1}. ${summarizeDocumentLine(document)}`);

  return [
    `I analyzed the most relevant filings for ${companyName || symbol} using a retrieval-first approach.`,
    `Question asked: "${question}"`,
    "",
    "Key extracted points:",
    ...scopeSummary,
    "",
    "Interpretation:",
    "The available filings indicate where management focus and reported updates are concentrated. For deeper confidence, always cross-check full filings and track updates across multiple quarters.",
  ].join("\n");
}

function buildSummaryAnswer({ companyName, symbol, documents, year, quarter }) {
  const scopeLineParts = [];
  if (year) {
    scopeLineParts.push(`year filter: ${year}`);
  }
  if (quarter) {
    scopeLineParts.push(`quarter filter: ${quarter}`);
  }
  const scopeLine = scopeLineParts.length > 0 ? scopeLineParts.join(", ") : "all available periods";

  const topLines = documents.slice(0, 6).map((document, index) => `${index + 1}. ${summarizeDocumentLine(document)}`);
  const metricSignals = extractMetricSignals(documents);
  const metricsSection =
    metricSignals.length > 0 ? metricSignals.map((line) => `- ${line}`) : ["- Explicit numeric detail is limited in the retrieved snippets; rely on full result PDFs for exact values."];

  return [
    `Point-by-point deep analysis (${companyName || symbol}, scope: ${scopeLine})`,
    "Value-add details: tie each claim to a specific filing type and period.",
    "Helpful depth: focus on trend direction and management consistency across quarters, not isolated one-off prints.",
    "Often ignored but important: contradictions between announcement tone and detailed filing disclosures.",
    "",
    "Business model breakdown",
    "Value-add details: identify revenue engines, cost drivers, and what management calls out as strategic priorities.",
    "Helpful depth: explain how each business segment can affect operating leverage and cash conversion.",
    "Often ignored but important: concentration risk by segment, geography, or regulatory dependency.",
    "",
    "Key financial metrics and what they indicate",
    ...metricsSection,
    "Value-add details: connect revenue/profit/margin commentary to quarter-over-quarter direction.",
    "Helpful depth: include enough context to explain direction, avoid overloading with line-item accounting trivia.",
    "Often ignored but important: whether improvements come from sustainable operations or temporary factors.",
    "",
    "Management commentary -> numbers -> long-term implications",
    "Value-add details: check if commentary about growth, margins, and discipline is visible in disclosed numbers.",
    "Helpful depth: map management statements to 2-3 measurable monitorables over future quarters.",
    "Often ignored but important: repeated guidance drift, softened language, or delayed target timelines.",
    "",
    "Risks, red flags, and consistency checks",
    "Value-add details: flag leverage, execution, regulation, and competitive pressure where mentioned.",
    "Helpful depth: prioritize risk by probability and potential impact; avoid a generic risk laundry list.",
    "Often ignored but important: disclosures that quietly mention dependency, concentration, or policy sensitivity.",
    "",
    "Which points/sections should absolutely be included",
    "Value-add details: business model, core metrics trend, management-vs-numbers check, risks, and monitorables.",
    "Helpful depth: keep each section grounded in filing evidence with plain-language interpretation.",
    "Often ignored but important: what is still unknown and what new disclosures would invalidate the thesis.",
    "",
    "Evidence used:",
    ...topLines,
  ].join("\n");
}

function buildFollowUpQuestions({ companyName, year, quarter, topDocuments }) {
  const periodLabel = quarter || year || "the latest period";
  const suggested = [
    `Compare ${periodLabel} with the prior period and explain what changed meaningfully.`,
    "Which management claims are strongly backed by filed numbers, and which are still assumptions?",
    "What are the top 3 risks that could break this thesis over the next 12 months?",
    "What monitorables should I track every quarter before revising the stock story?",
  ];

  const hasConcall = topDocuments.some((document) => document.doc_type === "CONCALL_TRANSCRIPT");
  const hasFiling = topDocuments.some(
    (document) => document.doc_type === "DRHP" || document.doc_type === "RHP" || document.doc_type === "OFFER_DOCUMENT"
  );

  if (hasConcall) {
    suggested.push("From concall commentary, what should I verify in the next results release?");
  }

  if (hasFiling) {
    suggested.push("Which risk factors from filings still look under-discussed by the market?");
  }

  if (companyName) {
    suggested.push(`If I only track 5 things for ${companyName}, what should they be?`);
  }

  return Array.from(new Set(suggested)).slice(0, 6);
}

function normalizeCardLevel(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(5, Math.round(parsed)));
}

function createSummaryCardId(seed) {
  return `card_${stableHash(`${seed}-${Date.now()}-${Math.random().toString(16).slice(2)}`)}`;
}

function buildContextLines(documents) {
  return documents.map((document, index) => {
    const quarterLine = document.quarter ? `Quarter: ${document.quarter}` : "Quarter: n/a";
    const yearLine = document.fiscal_year ? `Fiscal year: ${document.fiscal_year}` : "Fiscal year: n/a";
    const summaryText = hasMeaningfulDescription(document) ? document.description : "No summary available.";
    const ragLine = document.rag_excerpt
      ? `Extracted filing text: ${normalizeWhitespace(document.rag_excerpt).slice(0, 1000)}`
      : "";
    return [
      `[D${index + 1}] ${document.title}`,
      `Type: ${document.doc_type}`,
      quarterLine,
      yearLine,
      `Published: ${document.published_at || "n/a"}`,
      `Source: ${document.source_name}`,
      `Summary: ${summaryText}`,
      ragLine,
    ].join("\n");
  });
}

function normalizeCardSources(rawSources, fallbackDocument) {
  if (Array.isArray(rawSources)) {
    const cleaned = rawSources
      .map((source) => {
        if (!source || typeof source !== "object") {
          return null;
        }
        const title = `${source.title || source.source_name || ""}`.trim();
        const url = `${source.url || ""}`.trim();
        const sourceName = `${source.source_name || ""}`.trim();
        if (!title && !url && !sourceName) {
          return null;
        }
        return {
          title: title || sourceName || "Source",
          url: url || undefined,
          source_name: sourceName || undefined,
        };
      })
      .filter((value) => Boolean(value));

    if (cleaned.length > 0) {
      return cleaned.slice(0, 4);
    }
  }

  if (fallbackDocument) {
    return [
      {
        title: fallbackDocument.title,
        url: fallbackDocument.source_url || fallbackDocument.file_url || undefined,
        source_name: fallbackDocument.source_name,
      },
    ];
  }

  return [];
}

function normalizeSummaryCard(rawCard, index, documents) {
  const fallbackDocument = documents[index % Math.max(1, documents.length)] || documents[0];
  const concept = `${rawCard?.concept || rawCard?.topic || fallbackDocument?.doc_type || "Concept"}`.trim();
  const title = `${rawCard?.title || concept || "Understanding card"}`.trim();
  const explanation = `${rawCard?.explanation || rawCard?.summary || ""}`.trim();
  const whyItMatters = `${rawCard?.why_it_matters || rawCard?.whyItMatters || ""}`.trim();
  const example = `${rawCard?.example || rawCard?.analogy || ""}`.trim();

  if (!title || !explanation) {
    return null;
  }

  return {
    id: `${rawCard?.id || createSummaryCardId(`${concept}-${index}`)}`.trim(),
    concept,
    title,
    explanation,
    why_it_matters: whyItMatters || "This helps convert filing language into practical investor understanding.",
    example: example || "Use this concept while reading the next filing update and compare wording vs numbers.",
    level: normalizeCardLevel(rawCard?.level, 1),
    source_refs: normalizeCardSources(rawCard?.source_refs, fallbackDocument),
  };
}

function buildFallbackSummaryCardsInit({ companyName, symbol, documents }) {
  const baseDocument = documents[0];
  if (!baseDocument) {
    return [
      {
        id: createSummaryCardId(`${symbol}-fallback-1`),
        concept: "Company overview",
        title: `${companyName || symbol}: starting point`,
        explanation: "No filing text was retrieved for this selection. Start with broader company context before deep analysis.",
        why_it_matters: "Without source filings, confidence in conclusions stays limited.",
        example: "Switch FY or filing scope and retry AI Summary.",
        level: 1,
        source_refs: [],
      },
    ];
  }

  const docTitle = baseDocument.title;
  const sourceRef = normalizeCardSources([], baseDocument);

  return [
    {
      id: createSummaryCardId(`${docTitle}-l1`),
      concept: "What this filing says",
      title: `Core idea from ${docTitle}`,
      explanation: `${baseDocument.description || "This filing outlines management updates and reported business context."}`,
      why_it_matters: "This is the baseline narrative before checking deeper evidence.",
      example: "Ask: does management tone align with reported trend direction?",
      level: 1,
      source_refs: sourceRef,
    },
    {
      id: createSummaryCardId(`${docTitle}-l2`),
      concept: "Evidence linkage",
      title: "Link commentary to disclosed numbers",
      explanation: "Match management statements with explicit data points and period labels from the filing.",
      why_it_matters: "Narrative-only analysis can miss inconsistencies.",
      example: "Track whether guidance language improved while key metrics also improved.",
      level: 2,
      source_refs: sourceRef,
    },
    {
      id: createSummaryCardId(`${docTitle}-l3`),
      concept: "Risk consistency",
      title: "Stress-test assumptions",
      explanation: "List what could invalidate the current thesis and which next disclosures would confirm or reject it.",
      why_it_matters: "Robust understanding requires explicit invalidation triggers.",
      example: "If margin commentary is positive, verify if cost intensity also improved next quarter.",
      level: 3,
      source_refs: sourceRef,
    },
  ];
}

function buildFallbackNextSummaryCard({ swipeDirection, currentCard, documents }) {
  const fallbackDocument = documents[0];
  const deeper = swipeDirection === "right";
  const nextLevel = deeper
    ? normalizeCardLevel((currentCard?.level ?? 1) + 1, 2)
    : normalizeCardLevel((currentCard?.level ?? 2) - 1, 1);
  const concept = `${currentCard?.concept || fallbackDocument?.doc_type || "Concept"}`.trim();
  const title = deeper ? `${concept}: go deeper` : `${concept}: simpler view`;

  return {
    id: createSummaryCardId(`${concept}-${swipeDirection}-${nextLevel}`),
    concept,
    title,
    explanation: deeper
      ? "This deeper layer focuses on cause-effect links between commentary, numbers, and likely forward implications."
      : "This view explains the same evidence from a different perspective to improve understanding.",
    why_it_matters: deeper
      ? "Depth helps detect thesis strength, fragility, and consistency over time."
      : "Alternative perspectives reduce blind spots and improve clarity.",
    example: deeper
      ? "Compare two sequential filings and identify one claim that strengthened and one that weakened."
      : "Reframe this using a customer, operations, or cash-flow lens and check if the insight still holds.",
    level: nextLevel,
    source_refs: normalizeCardSources([], fallbackDocument),
  };
}

function parseLlmOutput(data) {
  const choices = Array.isArray(data?.choices) ? data.choices : [];
  for (const choice of choices) {
    const message = choice?.message;
    if (!message) {
      continue;
    }

    if (typeof message.content === "string" && message.content.trim().length > 0) {
      return message.content.trim();
    }

    if (Array.isArray(message.content)) {
      const text = message.content
        .map((part) => {
          if (typeof part === "string") {
            return part.trim();
          }
          if (typeof part?.text === "string") {
            return part.text.trim();
          }
          return "";
        })
        .filter((value) => value.length > 0)
        .join("\n")
        .trim();
      if (text.length > 0) {
        return text;
      }
    }
  }

  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) {
      continue;
    }
    const text = parts
      .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
      .filter((value) => value.length > 0)
      .join("\n")
      .trim();
    if (text.length > 0) {
      return text;
    }
  }

  return null;
}

function tryParseJson(value) {
  if (typeof value !== "string") {
    return null;
  }

  const direct = value.trim();
  if (!direct) {
    return null;
  }

  try {
    return JSON.parse(direct);
  } catch {
    // Continues with relaxed parsing attempts.
  }

  const fenced = direct.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Falls through.
    }
  }

  const firstBrace = direct.indexOf("{");
  const lastBrace = direct.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(direct.slice(firstBrace, lastBrace + 1));
    } catch {
      // Falls through.
    }
  }

  const firstBracket = direct.indexOf("[");
  const lastBracket = direct.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    try {
      return JSON.parse(direct.slice(firstBracket, lastBracket + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function buildXaiHistory(history) {
  return history
    .slice(-6)
    .map((turn) => ({
      role: turn.role === "assistant" ? "assistant" : "user",
      content: turn.content,
    }));
}

async function requestXaiChatCompletion(payload) {
  const endpoint = "https://api.x.ai/v1/chat/completions";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${XAI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    const trimmedError = errorText.trim();
    throw new Error(
      trimmedError
        ? `LLM request failed (${response.status}): ${trimmedError.slice(0, 220)}`
        : `LLM request failed with status ${response.status}.`
    );
  }

  return response.json();
}

async function answerWithGrok({ question, companyName, symbol, documents, history, isSummaryRequest, ragChunks }) {
  if (!XAI_API_KEY) {
    throw new Error("LLM is not configured. Set XAI_API_KEY on the backend.");
  }

  if (documents.length === 0) {
    return null;
  }

  const contextLines = buildContextLines(documents);
  const chunkLines = buildChunkContextLines(Array.isArray(ragChunks) ? ragChunks : []);

  const summaryInstruction = isSummaryRequest
    ? [
        "When the user asks for a summary, you MUST use these sections in order:",
        "1. Point-by-point deep analysis",
        "2. Business model breakdown",
        "3. Key financial metrics and what they indicate",
        "4. Management commentary -> numbers -> long-term implications",
        "5. Risks, red flags, and consistency checks",
        "6. Which points/sections should absolutely be included",
        "Inside each section, explicitly include:",
        "- What details/interpretations add value",
        "- What level of depth is useful vs unnecessary",
        "- What usually gets ignored but should not be ignored",
        "Use chunk citations like [C1], [C2] to support claims whenever chunk evidence is available.",
      ].join("\n")
    : "Answer in concise, beginner-friendly language and cite chunk references like [C1], [C2] (or [D1], [D2] if only document-level evidence exists).";

  const systemPrompt = [
    "You are Groww AI for beginner investors.",
    "Use only the provided filing context.",
    "If data is missing, clearly say it is not available in retrieved documents.",
    "Do not provide buy/sell recommendations.",
    summaryInstruction,
  ].join("\n");

  const evidenceSections = [];
  if (chunkLines.length > 0) {
    evidenceSections.push("Retrieved filing chunks (highest priority evidence):");
    evidenceSections.push(chunkLines.join("\n\n"));
  }
  evidenceSections.push("Retrieved filing snippets (fallback context):");
  evidenceSections.push(contextLines.join("\n\n"));

  const questionPrompt = [
    `Company: ${companyName || symbol}`,
    `Symbol: ${symbol}`,
    `Question: ${question}`,
    ...evidenceSections,
  ].join("\n\n");

  const payload = {
    model: XAI_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      ...buildXaiHistory(history),
      { role: "user", content: questionPrompt },
    ],
    temperature: 0.2,
  };

  const data = await requestXaiChatCompletion(payload);
  const parsed = parseLlmOutput(data);

  if (!parsed) {
    throw new Error("LLM returned an empty answer.");
  }

  return parsed;
}

async function generateSummaryCardsWithGrok({
  mode,
  companyName,
  symbol,
  documents,
  ragChunks,
  swipeDirection,
  currentCard,
}) {
  if (!XAI_API_KEY) {
    throw new Error("LLM is not configured. Set XAI_API_KEY on the backend.");
  }

  const docContextLines = buildContextLines(documents).join("\n\n");
  const chunkContextLines = buildChunkContextLines(Array.isArray(ragChunks) ? ragChunks : []).join("\n\n");
  const contextLines = chunkContextLines
    ? `Chunk evidence:\n${chunkContextLines}\n\nDocument evidence:\n${docContextLines}`
    : docContextLines;

  const systemPrompt = [
    "You are Groww AI card composer for beginners.",
    "Return strict JSON only. Do not include markdown or extra prose.",
    "Use only provided filing context.",
    "If swipe direction is right: go deeper with more evidence from the report context.",
    "If swipe direction is left: explain from an alternative perspective to improve understanding.",
    "Each card must include: concept, title, explanation, why_it_matters, example, level, source_refs.",
    "source_refs should be an array of objects with title and optional url/source_name.",
  ].join("\n");

  const userPrompt =
    mode === "summary_cards_init"
      ? [
          `Company: ${companyName || symbol}`,
          `Symbol: ${symbol}`,
          "Task: Create 3 progressive summary cards (level 1 -> 3).",
          "Tone: plain language, high clarity, no investment advice.",
          "Output JSON shape: {\"cards\":[{...},{...},{...}]}",
          "Context:",
          contextLines,
        ].join("\n\n")
      : [
          `Company: ${companyName || symbol}`,
          `Symbol: ${symbol}`,
          `Current card: ${JSON.stringify(currentCard)}`,
          `Swipe direction: ${swipeDirection}`,
          swipeDirection === "right"
            ? "Task: Generate exactly 1 deeper follow-up card (higher level) with tighter report-grounded evidence."
            : "Task: Generate exactly 1 alternative-perspective card (different framing) to improve understanding.",
          "Output JSON shape: {\"cards\":[{...}]}",
          "Context:",
          contextLines,
        ].join("\n\n");

  const payload = {
    model: XAI_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: userPrompt,
      },
    ],
    temperature: 0.35,
  };

  const data = await requestXaiChatCompletion(payload);
  const rawText = parseLlmOutput(data);
  const parsedJson = tryParseJson(rawText);

  let rawCards = [];
  if (Array.isArray(parsedJson)) {
    rawCards = parsedJson;
  } else if (parsedJson && typeof parsedJson === "object") {
    if (Array.isArray(parsedJson.cards)) {
      rawCards = parsedJson.cards;
    } else if (parsedJson.card && typeof parsedJson.card === "object") {
      rawCards = [parsedJson.card];
    }
  }

  const normalizedCards = rawCards
    .map((rawCard, index) => normalizeSummaryCard(rawCard, index, documents))
    .filter((value) => Boolean(value));

  if (normalizedCards.length > 0) {
    return normalizedCards;
  }

  if (mode === "summary_cards_init") {
    return buildFallbackSummaryCardsInit({
      companyName,
      symbol,
      documents,
    });
  }

  return [
    buildFallbackNextSummaryCard({
      swipeDirection,
      currentCard,
      documents,
    }),
  ];
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/companies", async (req, res) => {
  try {
    const query = `${req.query.query || ""}`.trim().toLowerCase();
    const requestedLimit = Number(req.query.limit);
    const defaultLimit = query.length > 0 ? 200 : 6000;
    const limit = Number.isFinite(requestedLimit) ? requestedLimit : defaultLimit;
    if (!hasMasterDatabase()) {
      res.status(500).json({
        error:
          "Companies master is not configured. Set DATABASE_URL and import ISIN mapping into companies_master.",
      });
      return;
    }

    const masterCompanies = await fetchCompaniesFromMaster({ query, limit });

    if (Array.isArray(masterCompanies)) {
      res.json({ companies: masterCompanies });
      return;
    }
    res.status(503).json({
      error: "Companies master is temporarily unavailable. Check database connectivity.",
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch companies." });
  }
});

app.get("/api/documents", async (req, res) => {
  try {
    const symbol = `${req.query.symbol || ""}`.trim().toUpperCase();
    const docType = `${req.query.doc_type || "ALL"}`.trim();
    const internalDocType = toInternalDocTypeFilter(docType);
    const normalizedRequestedType = normalizeRequestedType(docType);
    const q = `${req.query.q || ""}`.trim().toLowerCase();
    const from = `${req.query.from || ""}`.trim();
    const to = `${req.query.to || ""}`.trim();
    const sort = `${req.query.sort || "newest"}`.trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(1, Number(req.query.page_size || 10));

    if (!symbol) {
      res.status(400).json({ error: "'symbol' query param is required." });
      return;
    }

    const rawItems = await loadRawDocuments(symbol, {
      documentType: normalizedRequestedType,
    });

    const filtered = rawItems
      .filter((item) => inferSymbol(item) === symbol)
      .filter((item) => matchesDocType(item, internalDocType))
      .filter((item) => withinDateRange(item, from || undefined, to || undefined))
      .filter((item) => {
        if (!q) {
          return true;
        }

        return inferSearchText(item).includes(q);
      });

    const sorted = sortRawDocuments(filtered, sort);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    if (hasRagDatabase() && XAI_API_KEY) {
      const preloadDocuments = sorted.slice(0, RAG_INGEST_PRELOAD_LIMIT).map((item) => normalizeChatDocument(item));
      void ensureRagCoverage(preloadDocuments, { blockingCount: 0 });
    }

    res.json({
      items: sorted.slice(start, end),
      total: sorted.length,
      page,
      page_size: pageSize,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch documents." });
  }
});

app.post("/api/rag/ingest", async (req, res) => {
  try {
    const symbol = `${req.body.symbol || ""}`.trim().toUpperCase();
    const docType = `${req.body.doc_type || "ALL"}`.trim();
    const limit = Math.max(1, Math.min(Number(req.body.limit) || RAG_INGEST_PRELOAD_LIMIT, 20));

    if (!symbol) {
      res.status(400).json({ error: "'symbol' is required." });
      return;
    }

    if (!hasRagDatabase()) {
      res.status(400).json({ error: "RAG database is unavailable. Set DATABASE_URL first." });
      return;
    }

    if (!XAI_API_KEY) {
      res.status(400).json({ error: "XAI_API_KEY is required for RAG ingestion." });
      return;
    }

    const normalizedRequestedType = normalizeRequestedType(docType);
    const internalDocType = toInternalDocTypeFilter(docType);
    const rawItems = await loadRawDocuments(symbol, {
      documentType: normalizedRequestedType,
    });

    const normalizedDocs = rawItems
      .filter((item) => inferSymbol(item) === symbol)
      .filter((item) => matchesDocType(item, internalDocType))
      .map((item) => normalizeChatDocument(item))
      .sort((left, right) => {
        const leftParsed = new Date(left.published_at).getTime();
        const rightParsed = new Date(right.published_at).getTime();
        const leftTs = Number.isFinite(leftParsed) ? leftParsed : 0;
        const rightTs = Number.isFinite(rightParsed) ? rightParsed : 0;
        return rightTs - leftTs;
      });

    const targetDocs = normalizedDocs.slice(0, limit);
    await ensureRagCoverage(targetDocs, {
      blockingCount: targetDocs.length,
    });

    const indexedIds = await findIndexedDocIds(targetDocs.map((document) => document.id));

    res.json({
      symbol,
      requested: targetDocs.length,
      indexed: indexedIds.size,
      rag_ready: indexedIds.size > 0,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to ingest documents into RAG store." });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const mode = `${req.body.mode || "chat"}`.trim().toLowerCase();
    const symbol = `${req.body.symbol || ""}`.trim().toUpperCase();
    const companyName = `${req.body.company_name || ""}`.trim();
    const question = `${req.body.question || ""}`.trim();
    const year = `${req.body.year || ""}`.trim();
    const swipeDirection = `${req.body.swipe_direction || ""}`.trim().toLowerCase();
    const currentCard = req.body.current_card;
    const docIds = Array.isArray(req.body.doc_ids)
      ? req.body.doc_ids
          .map((docId) => `${docId || ""}`.trim())
          .filter((docId) => docId.length > 0)
      : [];
    const quarter = normalizeYearLabel(req.body.quarter || "");
    const managementFocus = `${req.body.management_focus || ""}`.trim().toLowerCase();
    const filingsFocus = `${req.body.filings_focus || ""}`.trim().toLowerCase();
    const history = Array.isArray(req.body.history)
      ? req.body.history
          .slice(-10)
          .map((turn) => ({
            role: turn?.role === "assistant" ? "assistant" : "user",
            content: `${turn?.content || ""}`.trim(),
          }))
          .filter((turn) => turn.content.length > 0)
      : [];

    const validModes = new Set(["chat", "summary_cards_init", "summary_cards_next"]);
    if (!validModes.has(mode)) {
      res.status(400).json({ error: "'mode' must be one of: chat, summary_cards_init, summary_cards_next." });
      return;
    }

    if (!symbol) {
      res.status(400).json({ error: "'symbol' is required." });
      return;
    }

    if (mode === "chat" && !question) {
      res.status(400).json({ error: "'question' is required." });
      return;
    }

    if (!XAI_API_KEY) {
      res.status(500).json({
        error: "LLM is not configured. Add XAI_API_KEY in backend environment variables.",
      });
      return;
    }

    const rawItems = await loadRawDocuments(symbol);
    const normalized = rawItems
      .filter((item) => inferSymbol(item) === symbol)
      .map((item) => normalizeChatDocument(item));

    if (normalized.length === 0) {
      if (mode === "chat") {
        res.json({
          answer: `I could not find filings for ${symbol}. Try another symbol or remove filters.`,
          sources: [],
          follow_up_questions: [
            "Try a broader query without period filters.",
            "Ask for a business model overview after selecting a symbol with filings.",
          ],
        });
        return;
      }

      if (mode === "summary_cards_init") {
        res.json({
          cards: buildFallbackSummaryCardsInit({
            companyName: companyName || symbol,
            symbol,
            documents: [],
          }),
          sources: [],
          meta: {
            model_used: XAI_MODEL,
            retrieved_documents: 0,
            doc_scope_requested: docIds.length > 0,
          },
        });
        return;
      }

      if (swipeDirection !== "left" && swipeDirection !== "right") {
        res.status(400).json({ error: "'swipe_direction' must be 'left' or 'right'." });
        return;
      }

      const currentCardPayload =
        currentCard && typeof currentCard === "object"
          ? {
              concept: `${currentCard.concept || ""}`.trim(),
              title: `${currentCard.title || ""}`.trim(),
              level: normalizeCardLevel(currentCard.level, 1),
            }
          : null;

      if (!currentCardPayload || !currentCardPayload.title) {
        res.status(400).json({
          error: "'current_card' with at least a title is required for summary_cards_next.",
        });
        return;
      }

      res.json({
        cards: [
          buildFallbackNextSummaryCard({
            swipeDirection,
            currentCard: currentCardPayload,
            documents: [],
          }),
        ],
        sources: [],
        meta: {
          model_used: XAI_MODEL,
          retrieved_documents: 0,
          doc_scope_requested: docIds.length > 0,
          swipe_direction: swipeDirection,
        },
      });
      return;
    }

    const scopedByYear = normalized.filter((document) => matchesYearFilter(document, year));
    const activeDocuments = scopedByYear.length > 0 ? scopedByYear : normalized;
    const scopedByDocIds =
      docIds.length > 0 ? activeDocuments.filter((document) => docIds.includes(document.id)) : activeDocuments;
    const retrievalPool = scopedByDocIds.length > 0 ? scopedByDocIds : activeDocuments;

    const isSummaryRequest = SUMMARY_REGEX.test(question);
    const ranked = rankDocuments(retrievalPool, {
      keywords: tokenize(question),
      selectedQuarter: quarter,
      selectedManagementTopic: managementFocus,
      selectedFilingTopic: filingsFocus,
      isSummaryRequest,
    });

    const topDocuments = ranked.slice(0, 8);
    const contextDocuments = topDocuments.length > 0 ? topDocuments : retrievalPool.slice(0, 8);

    const enrichedContextDocuments = await enrichDocumentsWithPdfText(contextDocuments);
    await ensureRagCoverage(enrichedContextDocuments, {
      blockingCount: mode === "chat" ? 2 : 1,
    });

    const retrievalQuestion =
      mode === "chat"
        ? question
        : mode === "summary_cards_next"
          ? `${currentCard?.title || ""} ${currentCard?.concept || ""}`.trim() || "deeper filing understanding"
          : "business model metrics management commentary risks";

    const ragChunks = await retrieveRagChunksForQuestion({
      symbol,
      question: retrievalQuestion,
      docIds: enrichedContextDocuments.map((document) => document.id),
      year,
      limit: RAG_RETRIEVAL_LIMIT,
    });

    const chunkSources = buildChunkSources(ragChunks, 8);
    const fallbackSources = uniqueSources(enrichedContextDocuments, 8);
    const blendedSources = mergeUniqueSources(chunkSources, fallbackSources, 8);
    const confidenceMeta = deriveConfidenceMeta({
      ragChunks,
      documents: enrichedContextDocuments,
    });
    const finalCompanyName = companyName || enrichedContextDocuments[0]?.company_name || symbol;

    if (mode === "summary_cards_init") {
      try {
        const cards = await generateSummaryCardsWithGrok({
          mode,
          companyName: finalCompanyName,
          symbol,
          documents: enrichedContextDocuments,
          ragChunks,
        });

        res.json({
          cards,
          sources: blendedSources,
          meta: {
            model_used: XAI_MODEL,
            retrieved_documents: contextDocuments.length,
            enriched_documents: enrichedContextDocuments.filter((document) => Boolean(document.rag_excerpt)).length,
            retrieved_chunks: ragChunks.length,
            ...confidenceMeta,
            doc_scope_requested: docIds.length > 0,
          },
        });
      } catch (error) {
        res.status(502).json({
          error:
            error instanceof Error
              ? error.message
              : "LLM request failed while generating summary cards.",
        });
      }
      return;
    }

    if (mode === "summary_cards_next") {
      if (swipeDirection !== "left" && swipeDirection !== "right") {
        res.status(400).json({ error: "'swipe_direction' must be 'left' or 'right'." });
        return;
      }

      const currentCardPayload =
        currentCard && typeof currentCard === "object"
          ? {
              concept: `${currentCard.concept || ""}`.trim(),
              title: `${currentCard.title || ""}`.trim(),
              level: normalizeCardLevel(currentCard.level, 1),
            }
          : null;

      if (!currentCardPayload || !currentCardPayload.title) {
        res.status(400).json({
          error: "'current_card' with at least a title is required for summary_cards_next.",
        });
        return;
      }

      try {
        const cards = await generateSummaryCardsWithGrok({
          mode,
          companyName: finalCompanyName,
          symbol,
          documents: enrichedContextDocuments,
          ragChunks,
          swipeDirection,
          currentCard: currentCardPayload,
        });

        res.json({
          cards,
          sources: blendedSources,
          meta: {
            model_used: XAI_MODEL,
            retrieved_documents: contextDocuments.length,
            enriched_documents: enrichedContextDocuments.filter((document) => Boolean(document.rag_excerpt)).length,
            retrieved_chunks: ragChunks.length,
            ...confidenceMeta,
            doc_scope_requested: docIds.length > 0,
            swipe_direction: swipeDirection,
          },
        });
      } catch (error) {
        res.status(502).json({
          error:
            error instanceof Error
              ? error.message
              : "LLM request failed while generating the next summary card.",
        });
      }
      return;
    }

    let answer;
    try {
      answer = await answerWithGrok({
        question,
        companyName: finalCompanyName,
        symbol,
        documents: enrichedContextDocuments,
        ragChunks,
        history,
        isSummaryRequest,
      });
    } catch (error) {
      res.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : "LLM request failed while answering this query.",
      });
      return;
    }

    if (!answer) {
      answer = isSummaryRequest
        ? buildSummaryAnswer({
            companyName: finalCompanyName,
            symbol,
            documents: enrichedContextDocuments,
            year,
            quarter,
          })
        : buildDefaultAnswer({
            companyName: finalCompanyName,
            symbol,
            question,
            documents: enrichedContextDocuments,
          });
    }

    const sources = blendedSources;
    const followUpQuestions = buildFollowUpQuestions({
      companyName: finalCompanyName,
      year,
      quarter,
      topDocuments: enrichedContextDocuments,
    });

    res.json({
      answer,
      sources,
      follow_up_questions: followUpQuestions,
      meta: {
        model_used: XAI_MODEL,
        retrieved_documents: enrichedContextDocuments.length,
        enriched_documents: enrichedContextDocuments.filter((document) => Boolean(document.rag_excerpt)).length,
        retrieved_chunks: ragChunks.length,
        ...confidenceMeta,
        doc_scope_requested: docIds.length > 0,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to answer chat query." });
  }
});

if (HAS_DIST) {
  app.use(express.static(DIST_DIR));

  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) {
      next();
      return;
    }

    res.sendFile(DIST_INDEX_FILE);
  });
}

app.listen(PORT, () => {
  console.log(`Documents API server running on http://localhost:${PORT}`);
});
