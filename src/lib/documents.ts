import type { AssistantExtractedMetrics, AssistantNumericField } from "@/types/assistant";
import type {
  DocumentAnswer,
  DocumentKind,
  DocumentRecord,
  DocumentSource,
  QuarterlyRow,
} from "@/types/documents";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "what",
  "this",
  "that",
  "from",
  "your",
  "about",
  "into",
  "have",
  "has",
  "are",
  "was",
  "were",
  "when",
  "where",
  "which",
  "how",
  "can",
  "could",
  "would",
  "should",
  "explain",
  "show",
  "summarize",
  "summary",
  "please",
]);

const METRIC_CONFIG: Array<{ field: AssistantNumericField; patterns: RegExp[] }> = [
  {
    field: "revenueGrowth",
    patterns: [
      /(?:revenue|sales|income)\s+growth[^\d-]{0,20}(-?\d+(?:\.\d+)?)/i,
      /growth\s+in\s+(?:revenue|sales)[^\d-]{0,20}(-?\d+(?:\.\d+)?)/i,
    ],
  },
  {
    field: "roe",
    patterns: [
      /\broe\b[^\d-]{0,20}(-?\d+(?:\.\d+)?)/i,
      /return\s+on\s+equity[^\d-]{0,20}(-?\d+(?:\.\d+)?)/i,
    ],
  },
  {
    field: "debtToEquity",
    patterns: [
      /(?:debt\s*\/\s*equity|debt\s+to\s+equity)[^\d-]{0,20}(-?\d+(?:\.\d+)?)/i,
      /\bd\/e\b[^\d-]{0,20}(-?\d+(?:\.\d+)?)/i,
    ],
  },
  {
    field: "fcfMargin",
    patterns: [
      /(?:fcf|free\s+cash\s+flow)\s+margin[^\d-]{0,20}(-?\d+(?:\.\d+)?)/i,
      /cash\s+flow\s+margin[^\d-]{0,20}(-?\d+(?:\.\d+)?)/i,
    ],
  },
  {
    field: "pe",
    patterns: [
      /\bp\s*\/\s*e\b[^\d-]{0,20}(-?\d+(?:\.\d+)?)/i,
      /price\s+to\s+earnings[^\d-]{0,20}(-?\d+(?:\.\d+)?)/i,
    ],
  },
  {
    field: "pb",
    patterns: [
      /\bp\s*\/\s*b\b[^\d-]{0,20}(-?\d+(?:\.\d+)?)/i,
      /price\s+to\s+book[^\d-]{0,20}(-?\d+(?:\.\d+)?)/i,
    ],
  },
  {
    field: "roce",
    patterns: [
      /\broce\b[^\d-]{0,20}(-?\d+(?:\.\d+)?)/i,
      /return\s+on\s+capital\s+employed[^\d-]{0,20}(-?\d+(?:\.\d+)?)/i,
    ],
  },
];

interface UploadContext {
  name: string;
  kind: DocumentKind;
}

function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

function parseNumber(value: string): number | undefined {
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function createDocumentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function inferSourceFromName(fileName: string): DocumentSource {
  const lowered = fileName.toLowerCase();

  if (lowered.endsWith(".pdf")) {
    return "pdf";
  }
  if (lowered.endsWith(".csv")) {
    return "csv";
  }

  return "text";
}

function inferKindFromName(fileName: string): DocumentKind {
  const lowered = fileName.toLowerCase();

  if (lowered.includes("concall") || lowered.includes("transcript")) {
    return "concall";
  }
  if (lowered.includes("announcement") || lowered.includes("press")) {
    return "announcement";
  }
  if (lowered.includes("drhp")) {
    return "drhp";
  }
  if (lowered.includes("annual")) {
    return "annual";
  }
  if (lowered.includes("quarter") || lowered.includes("q1") || lowered.includes("q2") || lowered.includes("q3") || lowered.includes("q4")) {
    return "quarterly";
  }

  return "other";
}

async function parsePdfText(file: File): Promise<string> {
  const [{ GlobalWorkerOptions, getDocument }, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);

  GlobalWorkerOptions.workerSrc = worker.default;

  const buffer = await file.arrayBuffer();
  const loadingTask = getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => {
        if ("str" in item && typeof item.str === "string") {
          return item.str;
        }
        return "";
      })
      .join(" ");

    pages.push(pageText);
  }

  return normalizeText(pages.join("\n"));
}

function detectQuarterPeriod(sourceLine: string): string | null {
  const quarterMatch = sourceLine.match(/(Q[1-4]\s*FY\s*\d{2,4}|FY\s*\d{2,4}\s*Q[1-4])/i);
  if (quarterMatch?.[1]) {
    return quarterMatch[1].replace(/\s+/g, " ").trim().toUpperCase();
  }

  const monthQuarterMatch = sourceLine.match(/\b(Mar|Jun|Sep|Dec)\s*[- ]?(\d{2,4})\b/i);
  if (monthQuarterMatch?.[0]) {
    return monthQuarterMatch[0].replace(/\s+/g, " ").trim();
  }

  return null;
}

function parseCsvRows(content: string, docId: string): QuarterlyRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return [];
  }

  const headers = lines[0].split(",").map((cell) => cell.trim().toLowerCase());

  const periodIndex = headers.findIndex((header) =>
    ["quarter", "period", "date", "month", "fy", "qtr"].some((token) => header.includes(token))
  );
  const revenueIndex = headers.findIndex((header) =>
    ["revenue", "sales", "income"].some((token) => header.includes(token))
  );
  const profitIndex = headers.findIndex((header) =>
    ["profit", "pat", "net"].some((token) => header.includes(token))
  );
  const epsIndex = headers.findIndex((header) => header.includes("eps"));

  const rows: QuarterlyRow[] = [];

  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((cell) => cell.trim());
    const period = periodIndex >= 0 ? cells[periodIndex] : cells[0];

    if (!period) {
      continue;
    }

    rows.push({
      period,
      revenue: revenueIndex >= 0 ? parseNumber(cells[revenueIndex] ?? "") : undefined,
      profit: profitIndex >= 0 ? parseNumber(cells[profitIndex] ?? "") : undefined,
      eps: epsIndex >= 0 ? parseNumber(cells[epsIndex] ?? "") : undefined,
      sourceDocId: docId,
    });
  }

  return rows.slice(0, 20);
}

function extractQuarterlyRowsFromText(content: string, docId: string): QuarterlyRow[] {
  const rows: QuarterlyRow[] = [];
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const period = detectQuarterPeriod(line);
    if (!period) {
      continue;
    }

    const numberMatches = line.match(/-?\d+(?:,\d{3})*(?:\.\d+)?/g);
    if (!numberMatches || numberMatches.length < 2) {
      continue;
    }

    rows.push({
      period,
      revenue: parseNumber(numberMatches[0]),
      profit: parseNumber(numberMatches[1]),
      eps: parseNumber(numberMatches[2] ?? ""),
      sourceDocId: docId,
    });

    if (rows.length >= 20) {
      break;
    }
  }

  const uniqueRows: QuarterlyRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.period}-${row.revenue ?? ""}-${row.profit ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueRows.push(row);
  }

  return uniqueRows;
}

export function extractMetricsFromText(text: string): AssistantExtractedMetrics {
  const metrics: AssistantExtractedMetrics = {};

  for (const config of METRIC_CONFIG) {
    for (const pattern of config.patterns) {
      const match = text.match(pattern);
      if (!match?.[1]) {
        continue;
      }

      const numericValue = parseNumber(match[1]);
      if (numericValue == null) {
        continue;
      }

      metrics[config.field] = numericValue;
      break;
    }
  }

  return metrics;
}

function mergeMetricCandidates(candidates: AssistantExtractedMetrics[]): AssistantExtractedMetrics {
  const merged: AssistantExtractedMetrics = {};

  for (const candidate of candidates) {
    for (const [field, value] of Object.entries(candidate)) {
      if (value == null || merged[field as AssistantNumericField] != null) {
        continue;
      }

      merged[field as AssistantNumericField] = value;
    }
  }

  return merged;
}

export function collectMetricsFromDocuments(documents: DocumentRecord[]): AssistantExtractedMetrics {
  const candidates = documents.map((document) => document.metrics);
  return mergeMetricCandidates(candidates);
}

function buildDocumentSummaryRows(documents: DocumentRecord[]): string[] {
  const lines: string[] = [];

  for (const document of documents.slice(0, 5)) {
    const extractedMetricNames = Object.keys(document.metrics);
    const metricCopy =
      extractedMetricNames.length > 0
        ? `metrics detected: ${extractedMetricNames.join(", ")}`
        : "no strong metric match found";
    lines.push(`${document.name} (${document.kind}) - ${metricCopy}`);
  }

  return lines;
}

function deriveQuarterlyTrend(rows: QuarterlyRow[]): string | null {
  if (rows.length < 2) {
    return null;
  }

  const validRevenueRows = rows.filter((row) => row.revenue != null);
  if (validRevenueRows.length < 2) {
    return null;
  }

  const first = validRevenueRows[0].revenue as number;
  const last = validRevenueRows[validRevenueRows.length - 1].revenue as number;

  if (first === 0) {
    return null;
  }

  const changePercent = ((last - first) / Math.abs(first)) * 100;
  const direction = changePercent >= 0 ? "up" : "down";

  return `Revenue trend across parsed quarters is ${direction} ${Math.abs(changePercent).toFixed(1)}% (from ${first.toFixed(2)} to ${last.toFixed(2)}).`;
}

export function summarizeDocuments(documents: DocumentRecord[]): string {
  if (documents.length === 0) {
    return "No company documents are available in context. Add repository docs to generate a grounded summary.";
  }

  const byKind = documents.reduce<Record<DocumentKind, number>>(
    (accumulator, document) => {
      accumulator[document.kind] += 1;
      return accumulator;
    },
    {
      quarterly: 0,
      annual: 0,
      drhp: 0,
      announcement: 0,
      concall: 0,
      other: 0,
    }
  );

  const allRows = documents.flatMap((document) => document.quarterlyRows);
  const trend = deriveQuarterlyTrend(allRows);

  const parts = [
    `Loaded ${documents.length} document(s): ${byKind.quarterly} quarterly, ${byKind.annual} annual, ${byKind.drhp} DRHP, ${byKind.announcement} announcements, ${byKind.concall} concalls, ${byKind.other} other.`,
    ...buildDocumentSummaryRows(documents),
  ];

  if (trend) {
    parts.push(trend);
  }

  parts.push(
    "You can now ask Athena questions like: 'Summarize Q3 results', 'What are top risks from DRHP?', or 'Any margin pressure signs?'."
  );

  return parts.join("\n");
}

function tokenizeQuestion(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

interface DocumentChunk {
  docId: string;
  docName: string;
  content: string;
}

interface RankedChunk extends DocumentChunk {
  score: number;
}

function toChunks(documents: DocumentRecord[]): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];

  for (const document of documents) {
    const pieces = document.content
      .split(/[.\n]/)
      .map((piece) => piece.trim())
      .filter((piece) => piece.length > 25);

    for (const piece of pieces.slice(0, 300)) {
      chunks.push({
        docId: document.id,
        docName: document.name,
        content: piece,
      });
    }
  }

  return chunks;
}

function rankChunks(question: string, documents: DocumentRecord[], topN = 6): RankedChunk[] {
  const keywords = tokenizeQuestion(question);
  const chunks = toChunks(documents);

  return chunks
    .map((chunk) => {
      const loweredChunk = chunk.content.toLowerCase();
      const score = keywords.reduce((total, keyword) => {
        return total + (loweredChunk.includes(keyword) ? 1 : 0);
      }, 0);

      return {
        ...chunk,
        score,
      };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

function buildSnippetAnswer(ranked: RankedChunk[]): DocumentAnswer {
  const snippets = ranked.map((match) => {
    const normalized = match.content.length > 220 ? `${match.content.slice(0, 220)}...` : match.content;
    return `- ${normalized}`;
  });

  const sources = Array.from(new Set(ranked.map((match) => match.docName)));

  return {
    answer: [
      "I found relevant evidence in the company documents:",
      ...snippets,
      "These snippets are extracted directly from the loaded filings, so validate final interpretation with full reports.",
    ].join("\n"),
    sources,
  };
}

function getOpenAiApiKey(): string | null {
  const key = import.meta.env.VITE_OPENAI_API_KEY;
  if (typeof key !== "string") {
    return null;
  }

  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getOpenAiModel(): string {
  const model = import.meta.env.VITE_OPENAI_MODEL;
  if (typeof model === "string" && model.trim().length > 0) {
    return model.trim();
  }
  return "gpt-4.1-mini";
}

export function isDocumentLlmConfigured(): boolean {
  return getOpenAiApiKey() != null;
}

async function answerWithOpenAi(question: string, ranked: RankedChunk[]): Promise<string | null> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey || ranked.length === 0) {
    return null;
  }

  const context = ranked
    .map((chunk, index) => `[${index + 1}] ${chunk.docName}\n${chunk.content}`)
    .join("\n\n");

  const payload = {
    model: getOpenAiModel(),
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "You are Groww AI. Answer only from provided context. If answer is not present, explicitly say you cannot find it in the provided documents. Keep tone concise, factual, and non-advisory. Never provide buy/sell advice.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Question: ${question}\n\nContext snippets:\n${context}\n\nReturn a direct answer and cite snippet numbers like [1], [2].`,
          },
        ],
      },
    ],
    temperature: 0.2,
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    output_text?: string;
    output?: Array<{
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };

  if (typeof data.output_text === "string" && data.output_text.trim().length > 0) {
    return data.output_text.trim();
  }

  const flattened = data.output
    ?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text?.trim() ?? "")
    .filter((text) => text.length > 0);

  if (flattened && flattened.length > 0) {
    return flattened.join("\n").trim();
  }

  return null;
}

export async function answerQuestionFromDocuments(
  question: string,
  documents: DocumentRecord[]
): Promise<DocumentAnswer> {
  if (documents.length === 0) {
    return {
      answer: "No company documents loaded in context yet. Add repository docs to start doc-based Q&A.",
      sources: [],
    };
  }

  if (/\b(summary|summarize|overview|highlights)\b/i.test(question)) {
    return {
      answer: summarizeDocuments(documents),
      sources: documents.map((document) => document.name),
    };
  }

  const ranked = rankChunks(question, documents, 6);

  if (ranked.length === 0) {
    return {
      answer:
        "I could not find a direct match in the uploaded content. Try a specific question such as 'debt trend', 'ROE', 'contingent liabilities', or ask for a summary.",
      sources: [],
    };
  }

  try {
    const llmAnswer = await answerWithOpenAi(question, ranked);
    if (llmAnswer) {
      return {
        answer: llmAnswer,
        sources: Array.from(new Set(ranked.map((match) => match.docName))),
      };
    }
  } catch {
    // Falls back to deterministic retrieval answer when LLM call fails.
  }

  return buildSnippetAnswer(ranked.slice(0, 3));
}

async function readFileContent(file: File): Promise<string> {
  const loweredName = file.name.toLowerCase();

  if (loweredName.endsWith(".pdf")) {
    return parsePdfText(file);
  }

  return normalizeText(await file.text());
}

function parseQuarterlyRows(fileName: string, content: string, docId: string): QuarterlyRow[] {
  if (fileName.toLowerCase().endsWith(".csv")) {
    return parseCsvRows(content, docId);
  }

  return extractQuarterlyRowsFromText(content, docId);
}

function buildDocumentRecord(
  content: string,
  source: DocumentSource,
  context: UploadContext
): DocumentRecord {
  const id = createDocumentId();
  const normalizedContent = normalizeText(content);

  return {
    id,
    name: context.name,
    source,
    kind: context.kind,
    content: normalizedContent,
    createdAt: new Date().toISOString(),
    metrics: extractMetricsFromText(normalizedContent),
    quarterlyRows: parseQuarterlyRows(context.name, normalizedContent, id),
  };
}

export async function ingestFileDocument(file: File, forcedKind?: DocumentKind): Promise<DocumentRecord> {
  const source = inferSourceFromName(file.name);
  const kind = forcedKind ?? inferKindFromName(file.name);
  const content = await readFileContent(file);

  return buildDocumentRecord(content, source, {
    name: file.name,
    kind,
  });
}

export function createManualDocument(
  name: string,
  content: string,
  kind: DocumentKind
): DocumentRecord {
  const displayName = name.trim() || `Manual note ${new Date().toLocaleString()}`;

  return buildDocumentRecord(content, "manual", {
    name: displayName,
    kind,
  });
}

export function createRepositoryDocument(payload: {
  id: string;
  name: string;
  kind: DocumentKind;
  content: string;
  source?: DocumentSource;
  createdAt?: string;
}): DocumentRecord {
  const record = buildDocumentRecord(payload.content, payload.source ?? "text", {
    name: payload.name,
    kind: payload.kind,
  });

  return {
    ...record,
    id: payload.id,
    createdAt: payload.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
}
