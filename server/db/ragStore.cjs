const { createPool, hasMasterDatabase } = require("./companiesMaster.cjs");

const DEFAULT_EMBEDDING_DIM = 768;
const parsedDim = Number(process.env.RAG_EMBEDDING_DIM || DEFAULT_EMBEDDING_DIM);
const RAG_EMBEDDING_DIM = Number.isFinite(parsedDim)
  ? Math.max(128, Math.min(Math.round(parsedDim), 3072))
  : DEFAULT_EMBEDDING_DIM;

let schemaAttempted = false;
let schemaReady = false;

function hasRagDatabase() {
  return hasMasterDatabase();
}

function alignEmbeddingDimension(values) {
  const safeValues = Array.isArray(values)
    ? values.map((value) => (Number.isFinite(Number(value)) ? Number(value) : 0))
    : [];

  if (safeValues.length === RAG_EMBEDDING_DIM) {
    return safeValues;
  }

  if (safeValues.length > RAG_EMBEDDING_DIM) {
    return safeValues.slice(0, RAG_EMBEDDING_DIM);
  }

  const padded = safeValues.slice();
  while (padded.length < RAG_EMBEDDING_DIM) {
    padded.push(0);
  }
  return padded;
}

function toVectorLiteral(values) {
  const safeValues = alignEmbeddingDimension(values);
  return `[${safeValues.join(",")}]`;
}

async function ensureRagSchema() {
  const pool = createPool();
  if (!pool) {
    return false;
  }

  if (schemaReady) {
    return true;
  }

  if (schemaAttempted && !schemaReady) {
    return false;
  }

  schemaAttempted = true;

  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS filing_rag_chunks (
        chunk_id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        company_name TEXT,
        doc_type TEXT,
        title TEXT NOT NULL,
        quarter TEXT,
        fiscal_year TEXT,
        published_at TIMESTAMPTZ,
        source_name TEXT,
        source_url TEXT,
        file_url TEXT,
        chunk_index INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        chunk_tokens INTEGER NOT NULL DEFAULT 0,
        embedding vector(${RAG_EMBEDDING_DIM}) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS filing_rag_chunks_symbol_idx
      ON filing_rag_chunks (symbol);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS filing_rag_chunks_doc_id_idx
      ON filing_rag_chunks (doc_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS filing_rag_chunks_published_at_idx
      ON filing_rag_chunks (published_at DESC);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS filing_rag_chunks_embedding_idx
      ON filing_rag_chunks
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
    `);

    schemaReady = true;
    return true;
  } catch (error) {
    console.error("Failed to initialize RAG schema:", error.message);
    return false;
  }
}

async function findIndexedDocIds(docIds) {
  const normalized = Array.isArray(docIds)
    ? Array.from(new Set(docIds.map((value) => `${value || ""}`.trim()).filter((value) => value.length > 0)))
    : [];

  if (normalized.length === 0) {
    return new Set();
  }

  const isReady = await ensureRagSchema();
  if (!isReady) {
    return new Set();
  }

  const pool = createPool();
  const { rows } = await pool.query(
    `
      SELECT DISTINCT doc_id
      FROM filing_rag_chunks
      WHERE doc_id = ANY($1::text[]);
    `,
    [normalized]
  );

  return new Set(rows.map((row) => `${row.doc_id || ""}`.trim()).filter((value) => value.length > 0));
}

async function upsertRagChunks(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (safeRows.length === 0) {
    return 0;
  }

  const isReady = await ensureRagSchema();
  if (!isReady) {
    return 0;
  }

  const normalizedRows = safeRows
    .map((row) => ({
      chunk_id: `${row.chunk_id || ""}`.trim(),
      doc_id: `${row.doc_id || ""}`.trim(),
      symbol: `${row.symbol || ""}`.trim().toUpperCase(),
      company_name: `${row.company_name || ""}`.trim() || null,
      doc_type: `${row.doc_type || ""}`.trim() || null,
      title: `${row.title || ""}`.trim(),
      quarter: `${row.quarter || ""}`.trim() || null,
      fiscal_year: `${row.fiscal_year || ""}`.trim() || null,
      published_at: `${row.published_at || ""}`.trim() || null,
      source_name: `${row.source_name || ""}`.trim() || null,
      source_url: `${row.source_url || ""}`.trim() || null,
      file_url: `${row.file_url || ""}`.trim() || null,
      chunk_index: Math.max(0, Number(row.chunk_index) || 0),
      chunk_text: `${row.chunk_text || ""}`.trim(),
      chunk_tokens: Math.max(0, Number(row.chunk_tokens) || 0),
      embedding_literal: toVectorLiteral(alignEmbeddingDimension(row.embedding)),
    }))
    .filter((row) => row.chunk_id && row.doc_id && row.symbol && row.title && row.chunk_text && row.embedding_literal.length > 2);

  if (normalizedRows.length === 0) {
    return 0;
  }

  const pool = createPool();
  const { rowCount } = await pool.query(
    `
      WITH payload AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb) AS item(
          chunk_id TEXT,
          doc_id TEXT,
          symbol TEXT,
          company_name TEXT,
          doc_type TEXT,
          title TEXT,
          quarter TEXT,
          fiscal_year TEXT,
          published_at TEXT,
          source_name TEXT,
          source_url TEXT,
          file_url TEXT,
          chunk_index INTEGER,
          chunk_text TEXT,
          chunk_tokens INTEGER,
          embedding_literal TEXT
        )
      )
      INSERT INTO filing_rag_chunks (
        chunk_id,
        doc_id,
        symbol,
        company_name,
        doc_type,
        title,
        quarter,
        fiscal_year,
        published_at,
        source_name,
        source_url,
        file_url,
        chunk_index,
        chunk_text,
        chunk_tokens,
        embedding,
        updated_at
      )
      SELECT
        item.chunk_id,
        item.doc_id,
        item.symbol,
        item.company_name,
        item.doc_type,
        item.title,
        item.quarter,
        item.fiscal_year,
        NULLIF(item.published_at, '')::timestamptz,
        item.source_name,
        item.source_url,
        item.file_url,
        item.chunk_index,
        item.chunk_text,
        item.chunk_tokens,
        item.embedding_literal::vector,
        now()
      FROM payload AS item
      ON CONFLICT (chunk_id)
      DO UPDATE SET
        doc_id = EXCLUDED.doc_id,
        symbol = EXCLUDED.symbol,
        company_name = EXCLUDED.company_name,
        doc_type = EXCLUDED.doc_type,
        title = EXCLUDED.title,
        quarter = EXCLUDED.quarter,
        fiscal_year = EXCLUDED.fiscal_year,
        published_at = EXCLUDED.published_at,
        source_name = EXCLUDED.source_name,
        source_url = EXCLUDED.source_url,
        file_url = EXCLUDED.file_url,
        chunk_index = EXCLUDED.chunk_index,
        chunk_text = EXCLUDED.chunk_text,
        chunk_tokens = EXCLUDED.chunk_tokens,
        embedding = EXCLUDED.embedding,
        updated_at = now();
    `,
    [JSON.stringify(normalizedRows)]
  );

  return Number(rowCount) || normalizedRows.length;
}

async function searchRagChunks(options = {}) {
  const symbol = `${options.symbol || ""}`.trim().toUpperCase();
  const embedding = Array.isArray(options.embedding) ? options.embedding : [];
  const docIds = Array.isArray(options.docIds)
    ? Array.from(new Set(options.docIds.map((value) => `${value || ""}`.trim()).filter((value) => value.length > 0)))
    : [];
  const year = `${options.year || ""}`.trim().toUpperCase();
  const limit = Math.max(1, Math.min(Number(options.limit) || 8, 24));

  if (!symbol || embedding.length === 0) {
    return [];
  }

  const isReady = await ensureRagSchema();
  if (!isReady) {
    return [];
  }

  const pool = createPool();
  const vectorLiteral = toVectorLiteral(embedding);
  const hasDocIds = docIds.length > 0;

  const { rows } = await pool.query(
    `
      SELECT
        chunk_id,
        doc_id,
        symbol,
        company_name,
        doc_type,
        title,
        quarter,
        fiscal_year,
        published_at,
        source_name,
        source_url,
        file_url,
        chunk_index,
        chunk_text,
        chunk_tokens,
        1 - (embedding <=> $1::vector) AS similarity
      FROM filing_rag_chunks
      WHERE symbol = $2
        AND ($3::boolean = false OR doc_id = ANY($4::text[]))
        AND (
          $5::text = ''
          OR (fiscal_year IS NOT NULL AND upper(fiscal_year) LIKE '%' || $5 || '%')
          OR (published_at IS NOT NULL AND EXTRACT(YEAR FROM published_at)::text = $5)
        )
      ORDER BY embedding <=> $1::vector ASC
      LIMIT $6;
    `,
    [vectorLiteral, symbol, hasDocIds, docIds, year, limit]
  );

  return rows.map((row) => ({
    chunk_id: `${row.chunk_id || ""}`.trim(),
    doc_id: `${row.doc_id || ""}`.trim(),
    symbol: `${row.symbol || ""}`.trim(),
    company_name: `${row.company_name || ""}`.trim(),
    doc_type: `${row.doc_type || ""}`.trim(),
    title: `${row.title || ""}`.trim(),
    quarter: `${row.quarter || ""}`.trim(),
    fiscal_year: `${row.fiscal_year || ""}`.trim(),
    published_at: row.published_at ? new Date(row.published_at).toISOString() : "",
    source_name: `${row.source_name || ""}`.trim(),
    source_url: `${row.source_url || ""}`.trim(),
    file_url: `${row.file_url || ""}`.trim(),
    chunk_index: Number(row.chunk_index) || 0,
    chunk_text: `${row.chunk_text || ""}`.trim(),
    chunk_tokens: Number(row.chunk_tokens) || 0,
    similarity: Number(row.similarity) || 0,
  }));
}

function tokenizeQuery(text) {
  return `${text || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

async function searchRagChunksByKeywords(options = {}) {
  const symbol = `${options.symbol || ""}`.trim().toUpperCase();
  const query = `${options.query || ""}`.trim();
  const docIds = Array.isArray(options.docIds)
    ? Array.from(new Set(options.docIds.map((value) => `${value || ""}`.trim()).filter((value) => value.length > 0)))
    : [];
  const year = `${options.year || ""}`.trim().toUpperCase();
  const limit = Math.max(1, Math.min(Number(options.limit) || 8, 24));
  const probeLimit = Math.max(limit * 15, 120);

  if (!symbol || !query) {
    return [];
  }

  const isReady = await ensureRagSchema();
  if (!isReady) {
    return [];
  }

  const pool = createPool();
  const hasDocIds = docIds.length > 0;

  const { rows } = await pool.query(
    `
      SELECT
        chunk_id,
        doc_id,
        symbol,
        company_name,
        doc_type,
        title,
        quarter,
        fiscal_year,
        published_at,
        source_name,
        source_url,
        file_url,
        chunk_index,
        chunk_text,
        chunk_tokens
      FROM filing_rag_chunks
      WHERE symbol = $1
        AND ($2::boolean = false OR doc_id = ANY($3::text[]))
        AND (
          $4::text = ''
          OR (fiscal_year IS NOT NULL AND upper(fiscal_year) LIKE '%' || $4 || '%')
          OR (published_at IS NOT NULL AND EXTRACT(YEAR FROM published_at)::text = $4)
        )
      ORDER BY published_at DESC NULLS LAST
      LIMIT $5;
    `,
    [symbol, hasDocIds, docIds, year, probeLimit]
  );

  const tokens = tokenizeQuery(query);
  const scored = rows
    .map((row) => {
      const haystack = `${row.title || ""} ${row.chunk_text || ""}`.toLowerCase();
      let keywordScore = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) {
          keywordScore += 1;
        }
      }
      const density = tokens.length > 0 ? keywordScore / tokens.length : 0;

      return {
        row,
        score: density,
      };
    })
    .filter((item) => item.score > 0 || tokens.length === 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  return scored.map((item) => {
    const row = item.row;
    return {
      chunk_id: `${row.chunk_id || ""}`.trim(),
      doc_id: `${row.doc_id || ""}`.trim(),
      symbol: `${row.symbol || ""}`.trim(),
      company_name: `${row.company_name || ""}`.trim(),
      doc_type: `${row.doc_type || ""}`.trim(),
      title: `${row.title || ""}`.trim(),
      quarter: `${row.quarter || ""}`.trim(),
      fiscal_year: `${row.fiscal_year || ""}`.trim(),
      published_at: row.published_at ? new Date(row.published_at).toISOString() : "",
      source_name: `${row.source_name || ""}`.trim(),
      source_url: `${row.source_url || ""}`.trim(),
      file_url: `${row.file_url || ""}`.trim(),
      chunk_index: Number(row.chunk_index) || 0,
      chunk_text: `${row.chunk_text || ""}`.trim(),
      chunk_tokens: Number(row.chunk_tokens) || 0,
      similarity: Number(item.score) || 0,
    };
  });
}

module.exports = {
  RAG_EMBEDDING_DIM,
  hasRagDatabase,
  alignEmbeddingDimension,
  ensureRagSchema,
  findIndexedDocIds,
  upsertRagChunks,
  searchRagChunks,
  searchRagChunksByKeywords,
};
