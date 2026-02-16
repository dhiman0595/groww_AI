#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { upsertCompaniesMasterRows, hasMasterDatabase, closePool } = require("../server/db/companiesMaster.cjs");

function cleanText(value) {
  return `${value || ""}`.trim();
}

function cleanUpper(value) {
  return cleanText(value).toUpperCase();
}

function normalizeTicker(value) {
  return cleanUpper(value).replace(/\s+/g, "");
}

function normalizeExchange(value) {
  const normalized = cleanUpper(value);
  if (normalized === "NSE" || normalized === "BSE") {
    return normalized;
  }
  return normalized;
}

function parseArguments(argv) {
  const args = argv.slice(2);
  const flags = new Set(args.filter((arg) => arg.startsWith("--")));
  const fileArg = args.find((arg) => !arg.startsWith("--"));

  return {
    filePath: fileArg
      ? path.resolve(process.cwd(), fileArg)
      : path.resolve(process.cwd(), "ISIN_mapping.json"),
    replace: flags.has("--replace") || !flags.has("--upsert"),
  };
}

function normalizeMappingEntry(entry) {
  const isin = cleanUpper(entry?.isin);
  const companyName = cleanText(entry?.name);

  const exchangeTickerDetails = Array.isArray(entry?.exchange_ticker_details)
    ? entry.exchange_ticker_details
        .map((item) => ({
          exchange: normalizeExchange(item?.exchange),
          ticker: normalizeTicker(item?.ticker),
        }))
        .filter((item) => item.exchange.length > 0 && item.ticker.length > 0)
    : [];

  const nseSymbol = exchangeTickerDetails.find((item) => item.exchange === "NSE")?.ticker || "";
  const bseSymbol = exchangeTickerDetails.find((item) => item.exchange === "BSE")?.ticker || "";

  const primaryTickerEntry =
    exchangeTickerDetails.find((item) => item.exchange === "NSE") ||
    exchangeTickerDetails.find((item) => item.exchange === "BSE") ||
    exchangeTickerDetails[0];

  const primarySymbol = primaryTickerEntry?.ticker || "";
  const primaryExchange = primaryTickerEntry?.exchange || "NSE";

  const sector = cleanText(entry?.industry_info?.sector);
  const industry = cleanText(entry?.industry_info?.industry);

  const searchableText = [
    companyName,
    isin,
    primarySymbol,
    nseSymbol,
    bseSymbol,
    sector,
    industry,
    ...exchangeTickerDetails.map((item) => item.ticker),
  ]
    .filter((value) => value && value.length > 0)
    .join(" ")
    .toLowerCase();

  if (!isin || !companyName || !primarySymbol) {
    return null;
  }

  return {
    isin,
    company_name: companyName,
    sector,
    industry,
    nse_symbol: nseSymbol,
    bse_symbol: bseSymbol,
    primary_symbol: primarySymbol,
    primary_exchange: primaryExchange,
    exchange_ticker_details: exchangeTickerDetails,
    searchable_text: searchableText,
  };
}

async function main() {
  const { filePath, replace } = parseArguments(process.argv);

  if (!hasMasterDatabase()) {
    throw new Error("DATABASE_URL is not set. Export DATABASE_URL before running this import.");
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Mapping file not found at: ${filePath}`);
  }

  const rawText = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(rawText);

  if (!Array.isArray(parsed)) {
    throw new Error("Expected mapping JSON to be an array.");
  }

  let skipped = 0;
  const byIsin = new Map();

  for (const entry of parsed) {
    const normalized = normalizeMappingEntry(entry);
    if (!normalized) {
      skipped += 1;
      continue;
    }
    byIsin.set(normalized.isin, normalized);
  }

  const rows = Array.from(byIsin.values());

  const result = await upsertCompaniesMasterRows(rows, { replace });

  console.log(
    `Imported ${result.inserted} companies into companies_master (${replace ? "replace" : "upsert"} mode).`
  );
  console.log(`Parsed rows: ${parsed.length}, valid unique ISIN rows: ${rows.length}, skipped rows: ${skipped}.`);
}

(async () => {
  try {
    await main();
  } catch (error) {
    console.error(`Import failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await closePool().catch(() => {});
  }
})();
