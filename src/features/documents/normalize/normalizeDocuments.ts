import type {
  CompanyDocument,
  CompanyOption,
  DocumentType,
  DocumentTypeFilter,
  DocumentsQueryParams,
  DocumentsResponse,
  RawBseDocument,
  RawNseDocument,
  RawSebiDocument,
  RawSourceDocument,
  SortOrder,
} from "@/features/documents/types";

function stableHash(seed: string): string {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0).toString(16);
}

function normalizeIsoDate(value: string | undefined): string {
  if (!value) {
    return new Date(0).toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(0).toISOString();
  }

  return parsed.toISOString();
}

function mapNseDocumentType(category: RawNseDocument["category"]): DocumentType {
  switch (category) {
    case "Quarterly Result":
      return "QUARTERLY_RESULT";
    case "Corporate Announcement":
      return "ANNOUNCEMENT";
    case "Concall Transcript":
      return "CONCALL_TRANSCRIPT";
    case "Investor Presentation":
      return "INVESTOR_PRESENTATION";
    default:
      return "OTHER";
  }
}

function mapBseDocumentType(type: RawBseDocument["notice_type"]): DocumentType {
  switch (type) {
    case "Quarterly":
      return "QUARTERLY_RESULT";
    case "Announcement":
      return "ANNOUNCEMENT";
    case "Concall":
      return "CONCALL_TRANSCRIPT";
    case "Presentation":
      return "INVESTOR_PRESENTATION";
    default:
      return "OTHER";
  }
}

function mapSebiDocumentType(kind: RawSebiDocument["document_kind"]): DocumentType {
  switch (kind) {
    case "DRHP":
      return "DRHP";
    case "RHP":
      return "RHP";
    case "Offer Document":
      return "OFFER_DOCUMENT";
    default:
      return "OTHER";
  }
}

function normalizeNseDocument(raw: RawNseDocument): CompanyDocument {
  const idSeed = `${raw.provider}-${raw.filing_id}-${raw.symbol}-${raw.published_at}`;

  return {
    id: `doc_${stableHash(idSeed)}`,
    company_name: raw.company_name,
    symbol: raw.symbol,
    isin: raw.isin,
    exchange: "NSE",
    doc_type: mapNseDocumentType(raw.category),
    title: raw.headline,
    description: raw.details,
    quarter: raw.quarter,
    fiscal_year: raw.fiscal_year,
    published_at: normalizeIsoDate(raw.published_at),
    source_name: "NSE corporate filings",
    source_url: raw.page_url,
    file_url: raw.file_url,
    language: raw.language,
    tags: raw.tags,
  };
}

function normalizeBseDocument(raw: RawBseDocument): CompanyDocument {
  const idSeed = `${raw.provider}-${raw.notice_id}-${raw.symbol}-${raw.posted_at}`;

  return {
    id: `doc_${stableHash(idSeed)}`,
    company_name: raw.company,
    symbol: raw.symbol,
    isin: raw.isin,
    exchange: "BSE",
    doc_type: mapBseDocumentType(raw.notice_type),
    title: raw.subject,
    description: raw.note,
    quarter: raw.quarter,
    fiscal_year: raw.fiscal_year,
    published_at: normalizeIsoDate(raw.posted_at),
    source_name: "BSE corporate disclosures",
    source_url: raw.link,
    file_url: raw.attachment,
    language: raw.language,
    tags: raw.tags,
  };
}

function normalizeSebiDocument(raw: RawSebiDocument): CompanyDocument {
  const idSeed = `${raw.provider}-${raw.filing_no}-${raw.symbol}-${raw.filed_on}`;

  return {
    id: `doc_${stableHash(idSeed)}`,
    company_name: raw.issuer_name,
    symbol: raw.symbol,
    isin: raw.isin,
    exchange: "SEBI",
    doc_type: mapSebiDocumentType(raw.document_kind),
    title: `${raw.document_kind} filing`,
    description: raw.summary,
    published_at: normalizeIsoDate(raw.filed_on),
    source_name: "SEBI filings",
    source_url: raw.page_url,
    file_url: raw.pdf_url,
    language: raw.language,
    tags: raw.tags,
  };
}

export function normalizeRawDocument(raw: RawSourceDocument): CompanyDocument {
  switch (raw.provider) {
    case "NSE":
      return normalizeNseDocument(raw);
    case "BSE":
      return normalizeBseDocument(raw);
    case "SEBI":
      return normalizeSebiDocument(raw);
    default:
      return {
        id: `doc_${stableHash(JSON.stringify(raw))}`,
        company_name: "Unknown",
        symbol: "UNKNOWN",
        doc_type: "OTHER",
        title: "Unknown document",
        published_at: new Date(0).toISOString(),
        source_name: "Unknown",
        source_url: "",
      };
  }
}

export function normalizeRawDocuments(rawItems: RawSourceDocument[]): CompanyDocument[] {
  return rawItems.map(normalizeRawDocument);
}

export function deriveCompaniesFromDocuments(documents: CompanyDocument[]): CompanyOption[] {
  const bySymbol = new Map<string, CompanyOption>();

  for (const document of documents) {
    if (!bySymbol.has(document.symbol)) {
      bySymbol.set(document.symbol, {
        symbol: document.symbol,
        company_name: document.company_name,
        isin: document.isin,
        exchange: document.exchange,
      });
    }
  }

  return Array.from(bySymbol.values()).sort((a, b) =>
    a.company_name.localeCompare(b.company_name, "en", { sensitivity: "base" })
  );
}

function matchesTypeFilter(doc: CompanyDocument, filter: DocumentTypeFilter | undefined): boolean {
  if (!filter || filter === "ALL") {
    return true;
  }

  if (filter === "DRHP_RHP") {
    return doc.doc_type === "DRHP" || doc.doc_type === "RHP" || doc.doc_type === "OFFER_DOCUMENT";
  }

  return doc.doc_type === filter;
}

function matchesQuery(doc: CompanyDocument, query: string | undefined): boolean {
  if (!query?.trim()) {
    return true;
  }

  const haystack = [
    doc.title,
    doc.description ?? "",
    doc.company_name,
    doc.symbol,
    doc.quarter ?? "",
    doc.fiscal_year ?? "",
    ...(doc.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query.trim().toLowerCase());
}

function matchesDateRange(doc: CompanyDocument, from?: string, to?: string): boolean {
  const published = new Date(doc.published_at).getTime();
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

function sortDocuments(documents: CompanyDocument[], order: SortOrder = "newest"): CompanyDocument[] {
  return [...documents].sort((left, right) => {
    const leftTs = new Date(left.published_at).getTime();
    const rightTs = new Date(right.published_at).getTime();

    if (order === "oldest") {
      return leftTs - rightTs;
    }

    return rightTs - leftTs;
  });
}

export function applyDocumentsQuery(
  documents: CompanyDocument[],
  params: DocumentsQueryParams
): DocumentsResponse {
  const filtered = documents
    .filter((item) => item.symbol === params.symbol)
    .filter((item) => matchesTypeFilter(item, params.doc_type))
    .filter((item) => matchesQuery(item, params.q))
    .filter((item) => matchesDateRange(item, params.from, params.to));

  const sorted = sortDocuments(filtered, params.sort ?? "newest");

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.max(1, params.page_size ?? 10);
  const start = (page - 1) * pageSize;
  const end = start + pageSize;

  return {
    items: sorted.slice(start, end),
    total: sorted.length,
    page,
    page_size: pageSize,
  };
}
