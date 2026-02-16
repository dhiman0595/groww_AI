export type DocumentType =
  | "QUARTERLY_RESULT"
  | "ANNOUNCEMENT"
  | "DRHP"
  | "RHP"
  | "OFFER_DOCUMENT"
  | "CONCALL_TRANSCRIPT"
  | "INVESTOR_PRESENTATION"
  | "OTHER";

export interface CompanyDocument {
  id: string;
  company_name: string;
  symbol: string;
  isin?: string;
  exchange?: "NSE" | "BSE" | "SEBI" | "OTHER";
  doc_type: DocumentType;
  title: string;
  description?: string;
  quarter?: string;
  fiscal_year?: string;
  published_at: string;
  source_name: string;
  source_url: string;
  file_url?: string;
  language?: string;
  tags?: string[];
}

export interface CompanyOption {
  symbol: string;
  company_name: string;
  isin?: string;
  exchange?: "NSE" | "BSE" | "SEBI" | "OTHER";
}

export type SortOrder = "newest" | "oldest";

export type DocumentTypeFilter =
  | "ALL"
  | "QUARTERLY_RESULT"
  | "ANNOUNCEMENT"
  | "DRHP_RHP"
  | "CONCALL_TRANSCRIPT";

export interface DocumentsQueryParams {
  symbol: string;
  doc_type?: DocumentTypeFilter;
  q?: string;
  from?: string;
  to?: string;
  sort?: SortOrder;
  page?: number;
  page_size?: number;
}

export interface DocumentsResponse {
  items: CompanyDocument[];
  total: number;
  page: number;
  page_size: number;
}

export type RawSourceDocument = RawNseDocument | RawBseDocument | RawSebiDocument;

export interface RawNseDocument {
  provider: "NSE";
  filing_id: string;
  symbol: string;
  company_name: string;
  headline: string;
  category:
    | "Quarterly Result"
    | "Corporate Announcement"
    | "Concall Transcript"
    | "Investor Presentation"
    | "Other";
  details?: string;
  quarter?: string;
  fiscal_year?: string;
  published_at: string;
  page_url: string;
  file_url?: string;
  isin?: string;
  language?: string;
  tags?: string[];
}

export interface RawBseDocument {
  provider: "BSE";
  notice_id: string;
  scrip_code: string;
  symbol: string;
  company: string;
  subject: string;
  notice_type: "Announcement" | "Quarterly" | "Concall" | "Presentation" | "Other";
  note?: string;
  quarter?: string;
  fiscal_year?: string;
  posted_at: string;
  link: string;
  attachment?: string;
  isin?: string;
  language?: string;
  tags?: string[];
}

export interface RawSebiDocument {
  provider: "SEBI";
  filing_no: string;
  symbol: string;
  issuer_name: string;
  document_kind: "DRHP" | "RHP" | "Offer Document" | "Other";
  summary?: string;
  filed_on: string;
  page_url: string;
  pdf_url?: string;
  isin?: string;
  language?: string;
  tags?: string[];
}

export interface RawDocumentsResponse {
  items: RawSourceDocument[];
  total: number;
  page: number;
  page_size: number;
}

export interface RawCompaniesResponse {
  companies: CompanyOption[];
}
