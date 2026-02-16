const { createHash } = require("node:crypto");
const { normalizePublishedAtValue } = require("../utils/documentHelpers.cjs");

const FILINGS_FEED_ENDPOINT = `${
  process.env.STOCKINSIGHTS_API_URL || "https://stockinsights-ai-main-95a26a0.zuplo.app/api/in/v0/documents"
}`.trim();
const FILINGS_FEED_API_KEY = `${process.env.STOCKINSIGHTS_API_KEY || ""}`.trim();
const FILINGS_FEED_COMPANY_PARAM = `${process.env.STOCKINSIGHTS_COMPANY_PARAM || "ticker"}`.trim() || "ticker";

const SUPPORTED_DOCUMENT_TYPES = [
  "annual-report",
  "quarterly-result",
  "earnings-transcript",
  "investor-presentation",
  "announcement",
];

function cleanText(value) {
  return `${value || ""}`.trim();
}

function cleanUpperText(value) {
  return cleanText(value).toUpperCase();
}

function normalizeRequestedType(value) {
  const raw = cleanText(value);
  if (!raw || raw.toUpperCase() === "ALL") {
    return "ALL";
  }

  const lower = raw.toLowerCase();
  if (SUPPORTED_DOCUMENT_TYPES.includes(lower)) {
    return lower;
  }

  const upper = raw.toUpperCase();
  if (upper === "QUARTERLY_RESULT") return "quarterly-result";
  if (upper === "ANNOUNCEMENT") return "announcement";
  if (upper === "CONCALL_TRANSCRIPT") return "earnings-transcript";
  if (upper === "INVESTOR_PRESENTATION") return "investor-presentation";

  return "ALL";
}

function toRequestedTypeList(filter) {
  const normalized = normalizeRequestedType(filter);
  if (normalized === "ALL") {
    return SUPPORTED_DOCUMENT_TYPES;
  }
  return [normalized];
}

function hasFilingsFeedConfig() {
  return FILINGS_FEED_ENDPOINT.length > 0 && FILINGS_FEED_API_KEY.length > 0;
}

function buildAuthHeaderVariants(apiKey) {
  const rawToken = cleanText(apiKey).replace(/^Bearer\s+/i, "");
  if (!rawToken) {
    return null;
  }

  return [
    {
      Authorization: `Bearer ${rawToken}`,
      "x-api-key": rawToken,
    },
    {
      Authorization: rawToken,
      "x-api-key": rawToken,
    },
    {
      "x-api-key": rawToken,
    },
  ];
}

function pickString(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }

    if (typeof value === "number") {
      return `${value}`;
    }
  }

  return "";
}

function extractDocumentItems(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const candidateKeys = ["data", "documents", "items", "results", "records"];
  for (const key of candidateKeys) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }

    if (candidate && typeof candidate === "object") {
      for (const nestedKey of candidateKeys) {
        const nested = candidate[nestedKey];
        if (Array.isArray(nested)) {
          return nested;
        }
      }
    }
  }

  return [];
}

function normalizeApiDocumentType(rawType, fallbackType) {
  const lower = cleanText(rawType).toLowerCase();
  if (SUPPORTED_DOCUMENT_TYPES.includes(lower)) {
    return lower;
  }

  return normalizeRequestedType(fallbackType) === "ALL" ? "announcement" : normalizeRequestedType(fallbackType);
}

function toNseCategory(documentType) {
  switch (documentType) {
    case "quarterly-result":
      return "Quarterly Result";
    case "earnings-transcript":
      return "Concall Transcript";
    case "investor-presentation":
      return "Investor Presentation";
    case "announcement":
      return "Corporate Announcement";
    default:
      return "Other";
  }
}

function toBseNoticeType(documentType) {
  switch (documentType) {
    case "quarterly-result":
      return "Quarterly";
    case "earnings-transcript":
      return "Concall";
    case "investor-presentation":
      return "Presentation";
    case "announcement":
      return "Announcement";
    default:
      return "Other";
  }
}

function buildStableId(seed) {
  return createHash("sha1").update(seed).digest("hex").slice(0, 16);
}

function mapFeedDocumentToRaw(record, context) {
  const documentType = normalizeApiDocumentType(
    pickString(record, ["document_type", "doc_type", "type"]),
    context.documentType
  );

  const symbol =
    cleanUpperText(
      pickString(record, ["symbol", "ticker", "exchange_ticker", "nse_ticker", "company_symbol", "stock_symbol"])
    ) || cleanUpperText(context.symbol);

  const companyName = pickString(record, ["company_name", "company", "issuer_name", "security_name", "name"]);
  const title = pickString(record, ["title", "subject", "headline", "document_title", "name"]) ||
    `${companyName || symbol || "Company"} ${documentType}`;
  const description = pickString(record, ["description", "summary", "note", "details", "snippet"]);
  const quarter = pickString(record, ["quarter", "fiscal_quarter", "qtr"]);
  const fiscalYear = pickString(record, ["fiscal_year", "financial_year", "fy", "year"]);
  const publishedAt = normalizePublishedAtValue(
    pickString(record, [
      "published_date",
      "published_at",
      "published_on",
      "publishedDate",
      "created_at",
      "document_date",
      "announcement_date",
      "date",
      "timestamp",
    ])
  );
  const sourceUrl = pickString(record, ["source_url", "url", "link", "page_url", "document_url", "web_url"]);
  const fileUrl = pickString(record, ["file_url", "pdf_url", "download_url", "attachment_url", "transcript_url"]);
  const isin = cleanUpperText(pickString(record, ["isin", "isin_code"]));
  const exchange = cleanUpperText(pickString(record, ["exchange", "stock_exchange", "source_exchange"]));

  const idSeed = [
    symbol,
    title,
    publishedAt,
    sourceUrl,
    fileUrl,
    documentType,
  ].join("|");

  if (exchange === "BSE") {
    const noticeId =
      pickString(record, ["notice_id", "id", "document_id", "uuid", "filing_id"]) ||
      buildStableId(idSeed);

    return {
      provider: "BSE",
      notice_id: noticeId,
      scrip_code: pickString(record, ["scrip_code", "security_code", "code"]),
      symbol,
      company: companyName || symbol,
      subject: title,
      notice_type: toBseNoticeType(documentType),
      note: description,
      quarter,
      fiscal_year: fiscalYear,
      posted_at: publishedAt,
      link: sourceUrl || fileUrl,
      attachment: fileUrl,
      isin,
      language: pickString(record, ["language", "lang"]),
      tags: [],
    };
  }

  const filingId =
    pickString(record, ["filing_id", "id", "document_id", "uuid", "notice_id"]) ||
    buildStableId(idSeed);

  return {
    provider: "NSE",
    filing_id: filingId,
    symbol,
    company_name: companyName || symbol,
    headline: title,
    category: toNseCategory(documentType),
    details: description,
    quarter,
    fiscal_year: fiscalYear,
    published_at: publishedAt,
    page_url: sourceUrl || fileUrl,
    file_url: fileUrl,
    isin,
    language: pickString(record, ["language", "lang"]),
    tags: [],
  };
}

function dedupeRawDocuments(items) {
  const seen = new Set();
  const deduped = [];

  for (const item of items) {
    const key = [
      item.provider,
      item.symbol,
      item.filing_id || item.notice_id || "",
      item.headline || item.subject || "",
      item.published_at || item.posted_at || "",
      item.page_url || item.link || "",
      item.file_url || item.attachment || "",
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

async function fetchFeedDocumentsByType(options) {
  const authHeaderVariants = buildAuthHeaderVariants(FILINGS_FEED_API_KEY);
  if (!authHeaderVariants) {
    return [];
  }

  const documentType = options.documentType;
  const symbol = cleanUpperText(options.symbol);
  const companyParam = cleanText(options.companyParam || FILINGS_FEED_COMPANY_PARAM);

  if (!symbol) {
    return [];
  }

  const url = new URL(FILINGS_FEED_ENDPOINT);
  url.searchParams.set("document_type", documentType);
  url.searchParams.set(companyParam, symbol);

  let lastUnauthorizedMessage = "";

  for (const authHeaders of authHeaderVariants) {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        ...authHeaders,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        const reason = await response.text().catch(() => "");
        lastUnauthorizedMessage = reason.slice(0, 160);
        continue;
      }

      const body = await response.text().catch(() => "");
      console.error(`Filings feed request failed (${response.status}): ${body.slice(0, 180)}`);
      return [];
    }

    const payload = await response.json().catch(() => null);
    const records = extractDocumentItems(payload);
    return records.map((record) => mapFeedDocumentToRaw(record, { documentType, symbol }));
  }

  throw new Error(`Filings feed unauthorized. ${lastUnauthorizedMessage}`);
}

async function fetchFilingsFeedDocuments(options = {}) {
  if (!hasFilingsFeedConfig()) {
    return [];
  }

  const symbol = cleanUpperText(options.symbol);
  if (!symbol) {
    return [];
  }

  const requestedTypes = toRequestedTypeList(options.documentType);
  try {
    const chunks = await Promise.all(
      requestedTypes.map((documentType) =>
        fetchFeedDocumentsByType({
          symbol,
          documentType,
          companyParam: options.companyParam,
        })
      )
    );

    return dedupeRawDocuments(chunks.flat());
  } catch (error) {
    console.error("Filings feed adapter failed:", error.message);
    return [];
  }
}

module.exports = {
  fetchFilingsFeedDocuments,
  hasFilingsFeedConfig,
  normalizeRequestedType,
};
