import { MOCK_RAW_FIXTURES } from "@/features/documents/mock/rawFixtures";
import {
  applyDocumentsQuery,
  deriveCompaniesFromDocuments,
  normalizeRawDocuments,
} from "@/features/documents/normalize/normalizeDocuments";
import type {
  CompanyOption,
  DocumentsQueryParams,
  DocumentsResponse,
  RawCompaniesResponse,
  RawDocumentsResponse,
  RawSourceDocument,
} from "@/features/documents/types";

const DOCS_MODE = (import.meta.env.VITE_DOCS_MODE ?? "mock").trim().toLowerCase();
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").trim();

function isMockMode(): boolean {
  return DOCS_MODE !== "real";
}

function withBaseUrl(pathname: string): string {
  if (!API_BASE_URL) {
    return pathname;
  }

  return `${API_BASE_URL.replace(/\/$/, "")}${pathname}`;
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || `${value}`.length === 0) {
      continue;
    }
    searchParams.set(key, `${value}`);
  }

  const serialized = searchParams.toString();
  return serialized ? `?${serialized}` : "";
}

function getMockRawItems(): RawSourceDocument[] {
  return [...MOCK_RAW_FIXTURES.nse, ...MOCK_RAW_FIXTURES.bse, ...MOCK_RAW_FIXTURES.sebi];
}

function filterCompaniesByQuery(companies: CompanyOption[], query?: string): CompanyOption[] {
  if (!query?.trim()) {
    return companies;
  }

  const term = query.trim().toLowerCase();

  return companies.filter((company) => {
    const text = `${company.company_name} ${company.symbol} ${company.isin ?? ""}`.toLowerCase();
    return text.includes(term);
  });
}

export async function fetchCompanies(query?: string): Promise<CompanyOption[]> {
  if (isMockMode()) {
    const documents = normalizeRawDocuments(getMockRawItems());
    return filterCompaniesByQuery(deriveCompaniesFromDocuments(documents), query);
  }

  const endpoint = withBaseUrl(`/api/companies${toQueryString({ query })}`);
  const response = await fetch(endpoint);

  if (!response.ok) {
    throw new Error("Failed to load companies from API.");
  }

  const payload = (await response.json()) as RawCompaniesResponse;
  return filterCompaniesByQuery(payload.companies, query);
}

export async function fetchDocuments(params: DocumentsQueryParams): Promise<DocumentsResponse> {
  if (isMockMode()) {
    const normalized = normalizeRawDocuments(getMockRawItems());
    return applyDocumentsQuery(normalized, params);
  }

  const endpoint = withBaseUrl(
    `/api/documents${toQueryString({
      symbol: params.symbol,
      doc_type: params.doc_type,
      q: params.q,
      from: params.from,
      to: params.to,
      sort: params.sort,
      page: params.page,
      page_size: params.page_size,
    })}`
  );

  const response = await fetch(endpoint);

  if (!response.ok) {
    throw new Error("Failed to load documents from API.");
  }

  const payload = (await response.json()) as RawDocumentsResponse;
  const normalized = normalizeRawDocuments(payload.items);

  return {
    items: normalized,
    total: payload.total,
    page: payload.page,
    page_size: payload.page_size,
  };
}

export function getDocsModeLabel(): "mock" | "real" {
  return isMockMode() ? "mock" : "real";
}
