function inferDocumentType(raw) {
  if (raw.provider === "NSE") {
    if (raw.category === "Quarterly Result") return "QUARTERLY_RESULT";
    if (raw.category === "Corporate Announcement") return "ANNOUNCEMENT";
    if (raw.category === "Concall Transcript") return "CONCALL_TRANSCRIPT";
    if (raw.category === "Investor Presentation") return "INVESTOR_PRESENTATION";
    return "OTHER";
  }

  if (raw.provider === "BSE") {
    if (raw.notice_type === "Quarterly") return "QUARTERLY_RESULT";
    if (raw.notice_type === "Announcement") return "ANNOUNCEMENT";
    if (raw.notice_type === "Concall") return "CONCALL_TRANSCRIPT";
    if (raw.notice_type === "Presentation") return "INVESTOR_PRESENTATION";
    return "OTHER";
  }

  if (raw.provider === "SEBI") {
    if (raw.document_kind === "DRHP") return "DRHP";
    if (raw.document_kind === "RHP") return "RHP";
    if (raw.document_kind === "Offer Document") return "OFFER_DOCUMENT";
    return "OTHER";
  }

  return "OTHER";
}

function inferSymbol(raw) {
  return raw.symbol || "UNKNOWN";
}

function inferCompanyName(raw) {
  if (raw.provider === "NSE") return raw.company_name || raw.symbol;
  if (raw.provider === "BSE") return raw.company || raw.symbol;
  if (raw.provider === "SEBI") return raw.issuer_name || raw.symbol;
  return raw.symbol || "Unknown";
}

function inferPublishedAt(raw) {
  if (raw.provider === "NSE") return raw.published_at || "1970-01-01T00:00:00.000Z";
  if (raw.provider === "BSE") return raw.posted_at || "1970-01-01T00:00:00.000Z";
  if (raw.provider === "SEBI") return raw.filed_on || "1970-01-01T00:00:00.000Z";
  return "1970-01-01T00:00:00.000Z";
}

function inferSearchText(raw) {
  if (raw.provider === "NSE") {
    return `${raw.headline} ${raw.details || ""} ${raw.symbol} ${raw.company_name}`.toLowerCase();
  }

  if (raw.provider === "BSE") {
    return `${raw.subject} ${raw.note || ""} ${raw.symbol} ${raw.company}`.toLowerCase();
  }

  if (raw.provider === "SEBI") {
    return `${raw.document_kind} ${raw.summary || ""} ${raw.symbol} ${raw.issuer_name}`.toLowerCase();
  }

  return "";
}

function matchesDocType(raw, docTypeFilter) {
  if (!docTypeFilter || docTypeFilter === "ALL") {
    return true;
  }

  const inferred = inferDocumentType(raw);

  if (docTypeFilter === "DRHP_RHP") {
    return inferred === "DRHP" || inferred === "RHP" || inferred === "OFFER_DOCUMENT";
  }

  return inferred === docTypeFilter;
}

function withinDateRange(raw, from, to) {
  const published = new Date(inferPublishedAt(raw)).getTime();
  if (!Number.isFinite(published)) {
    return false;
  }

  if (from) {
    const fromTs = new Date(`${from}T00:00:00.000Z`).getTime();
    if (Number.isFinite(fromTs) && published < fromTs) {
      return false;
    }
  }

  if (to) {
    const toTs = new Date(`${to}T23:59:59.999Z`).getTime();
    if (Number.isFinite(toTs) && published > toTs) {
      return false;
    }
  }

  return true;
}

function sortRawDocuments(rawItems, sortOrder) {
  const mode = sortOrder === "oldest" ? "oldest" : "newest";

  return [...rawItems].sort((left, right) => {
    const leftTs = new Date(inferPublishedAt(left)).getTime();
    const rightTs = new Date(inferPublishedAt(right)).getTime();

    if (mode === "oldest") {
      return leftTs - rightTs;
    }

    return rightTs - leftTs;
  });
}

function buildCompanies(rawItems) {
  const map = new Map();

  for (const item of rawItems) {
    const symbol = inferSymbol(item);
    if (map.has(symbol)) {
      continue;
    }

    map.set(symbol, {
      symbol,
      company_name: inferCompanyName(item),
      isin: item.isin,
      exchange: item.provider,
    });
  }

  return Array.from(map.values()).sort((a, b) => a.company_name.localeCompare(b.company_name));
}

module.exports = {
  inferDocumentType,
  inferSymbol,
  inferSearchText,
  inferPublishedAt,
  matchesDocType,
  withinDateRange,
  sortRawDocuments,
  buildCompanies,
};
