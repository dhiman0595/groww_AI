const { Pool } = require("pg");

const DATABASE_URL = `${process.env.DATABASE_URL || ""}`.trim();
const HAS_DATABASE_URL = DATABASE_URL.length > 0;

let pool = null;
let schemaEnsured = false;

function cleanText(value) {
  return `${value || ""}`.trim();
}

function cleanUpperText(value) {
  return cleanText(value).toUpperCase();
}

function hasSslRequirement(connectionString) {
  return /sslmode=require/i.test(connectionString) || /\.neon\.tech\b/i.test(connectionString);
}

function createPool() {
  if (!HAS_DATABASE_URL) {
    return null;
  }

  if (pool) {
    return pool;
  }

  const needsSsl = hasSslRequirement(DATABASE_URL);

  pool = new Pool({
    connectionString: DATABASE_URL,
    ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  pool.on("error", (error) => {
    console.error("Postgres pool error:", error.message);
  });

  return pool;
}

function hasMasterDatabase() {
  return HAS_DATABASE_URL;
}

async function closePool() {
  if (!pool) {
    return;
  }

  const activePool = pool;
  pool = null;
  schemaEnsured = false;
  await activePool.end();
}

async function ensureCompaniesMasterSchema() {
  const activePool = createPool();
  if (!activePool) {
    return false;
  }

  if (schemaEnsured) {
    return true;
  }

  await activePool.query(`
    CREATE TABLE IF NOT EXISTS companies_master (
      isin TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      sector TEXT,
      industry TEXT,
      nse_symbol TEXT,
      bse_symbol TEXT,
      primary_symbol TEXT NOT NULL,
      primary_exchange TEXT NOT NULL,
      exchange_ticker_details JSONB NOT NULL DEFAULT '[]'::jsonb,
      searchable_text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await activePool.query(`
    CREATE INDEX IF NOT EXISTS companies_master_primary_symbol_idx
    ON companies_master (primary_symbol);
  `);

  await activePool.query(`
    CREATE INDEX IF NOT EXISTS companies_master_company_name_idx
    ON companies_master (company_name);
  `);

  await activePool.query(`
    CREATE INDEX IF NOT EXISTS companies_master_searchable_text_idx
    ON companies_master (searchable_text);
  `);

  try {
    await activePool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    await activePool.query(`
      CREATE INDEX IF NOT EXISTS companies_master_searchable_text_trgm_idx
      ON companies_master
      USING GIN (searchable_text gin_trgm_ops);
    `);
  } catch (error) {
    // Trigram index is an optimization; continue if extension creation is restricted.
    console.warn("Skipping pg_trgm index setup:", error.message);
  }

  schemaEnsured = true;
  return true;
}

function normalizeExchange(value) {
  const normalized = cleanUpperText(value);
  if (normalized === "NSE" || normalized === "BSE") {
    return normalized;
  }
  return "NSE";
}

function normalizeTicker(value) {
  return cleanUpperText(value).replace(/\s+/g, "");
}

function normalizeSearchableText(value) {
  return cleanText(value).toLowerCase();
}

async function fetchCompaniesFromMaster(options = {}) {
  const activePool = createPool();
  if (!activePool) {
    return null;
  }

  try {
    await ensureCompaniesMasterSchema();

    const term = normalizeSearchableText(options.query);
    const requestedLimit = Number(options.limit);
    const defaultLimit = term.length > 0 ? 300 : 100;
    const limit = Math.max(
      1,
      Math.min(Number.isFinite(requestedLimit) ? requestedLimit : defaultLimit, 50000)
    );

    const { rows } = await activePool.query(
      `
        WITH filtered AS (
          SELECT
            primary_symbol AS symbol,
            company_name,
            isin,
            primary_exchange AS exchange,
            searchable_text,
            CASE
              WHEN $1 <> '' AND lower(primary_symbol) = $1 THEN 0
              WHEN $1 <> '' AND lower(company_name) LIKE $1 || '%' THEN 1
              WHEN $1 <> '' AND searchable_text LIKE $1 || '%' THEN 2
              ELSE 3
            END AS rank_bucket,
            ROW_NUMBER() OVER (
              PARTITION BY primary_symbol
              ORDER BY company_name ASC, isin ASC
            ) AS symbol_rank
          FROM companies_master
          WHERE $1 = '' OR searchable_text LIKE '%' || $1 || '%'
        )
        SELECT symbol, company_name, isin, exchange
        FROM filtered
        WHERE symbol_rank = 1
        ORDER BY rank_bucket ASC, company_name ASC
        LIMIT $2;
      `,
      [term, limit]
    );

    return rows.map((row) => ({
      symbol: cleanUpperText(row.symbol),
      company_name: cleanText(row.company_name),
      isin: cleanUpperText(row.isin),
      exchange: normalizeExchange(row.exchange),
    }));
  } catch (error) {
    console.error("Failed to read companies master table:", error.message);
    return null;
  }
}

async function upsertCompaniesMasterRows(rows, options = {}) {
  const activePool = createPool();
  if (!activePool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  await ensureCompaniesMasterSchema();

  const replace = options.replace === true;
  const safeRows = Array.isArray(rows) ? rows : [];

  const client = await activePool.connect();
  let inserted = 0;

  try {
    await client.query("BEGIN");

    if (replace) {
      await client.query("TRUNCATE TABLE companies_master");
    }

    const normalizedRows = [];

    for (const row of safeRows) {
      const isin = cleanUpperText(row.isin);
      const companyName = cleanText(row.company_name);
      const primarySymbol = normalizeTicker(row.primary_symbol);

      if (!isin || !companyName || !primarySymbol) {
        continue;
      }

      const exchangeTickerDetails = Array.isArray(row.exchange_ticker_details)
        ? row.exchange_ticker_details.map((item) => ({
            exchange: normalizeExchange(item.exchange),
            ticker: normalizeTicker(item.ticker),
          }))
        : [];

      const nseSymbol = normalizeTicker(row.nse_symbol);
      const bseSymbol = normalizeTicker(row.bse_symbol);

      const searchableText = normalizeSearchableText(
        row.searchable_text ||
          [
            companyName,
            isin,
            primarySymbol,
            nseSymbol,
            bseSymbol,
            ...exchangeTickerDetails.map((item) => item.ticker),
          ]
            .filter((value) => value && value.length > 0)
            .join(" ")
      );

      normalizedRows.push({
        isin,
        company_name: companyName,
        sector: cleanText(row.sector) || null,
        industry: cleanText(row.industry) || null,
        nse_symbol: nseSymbol || null,
        bse_symbol: bseSymbol || null,
        primary_symbol: primarySymbol,
        primary_exchange: normalizeExchange(row.primary_exchange),
        exchange_ticker_details: exchangeTickerDetails,
        searchable_text: searchableText,
      });
    }

    if (normalizedRows.length > 0) {
      await client.query(
        `
          WITH payload AS (
            SELECT *
            FROM jsonb_to_recordset($1::jsonb) AS item(
              isin TEXT,
              company_name TEXT,
              sector TEXT,
              industry TEXT,
              nse_symbol TEXT,
              bse_symbol TEXT,
              primary_symbol TEXT,
              primary_exchange TEXT,
              exchange_ticker_details JSONB,
              searchable_text TEXT
            )
          )
          INSERT INTO companies_master (
            isin,
            company_name,
            sector,
            industry,
            nse_symbol,
            bse_symbol,
            primary_symbol,
            primary_exchange,
            exchange_ticker_details,
            searchable_text,
            updated_at
          )
          SELECT
            isin,
            company_name,
            sector,
            industry,
            nse_symbol,
            bse_symbol,
            primary_symbol,
            primary_exchange,
            exchange_ticker_details,
            searchable_text,
            now()
          FROM payload
          ON CONFLICT (isin)
          DO UPDATE SET
            company_name = EXCLUDED.company_name,
            sector = EXCLUDED.sector,
            industry = EXCLUDED.industry,
            nse_symbol = EXCLUDED.nse_symbol,
            bse_symbol = EXCLUDED.bse_symbol,
            primary_symbol = EXCLUDED.primary_symbol,
            primary_exchange = EXCLUDED.primary_exchange,
            exchange_ticker_details = EXCLUDED.exchange_ticker_details,
            searchable_text = EXCLUDED.searchable_text,
            updated_at = now();
        `,
        [JSON.stringify(normalizedRows)]
      );
    }

    inserted = normalizedRows.length;
    await client.query("COMMIT");
    return { inserted, replace };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createPool,
  closePool,
  hasMasterDatabase,
  ensureCompaniesMasterSchema,
  fetchCompaniesFromMaster,
  upsertCompaniesMasterRows,
};
