export type FlashcardTag =
  | "Financials"
  | "Product"
  | "Strategy"
  | "Operations"
  | "Risk"
  | "Regulation"
  | "Guidance";

export interface AiFlashcardsMeta {
  company: string;
  period: string;
  doc_type: "concall_transcript";
  generated_at: string;
}

export interface AiFlashcard {
  id: string;
  title: string;
  tag: FlashcardTag;
  summary: string;
  evidence: [AiFlashcardEvidence, ...AiFlashcardEvidence[]];
  why_it_matters: string;
  confidence: number;
}

export interface AiFlashcardEvidence {
  type: "metric" | "quote";
  text: string;
  source_ref: string;
}

export interface AiFlashcardsResponse {
  meta: AiFlashcardsMeta;
  cards: AiFlashcard[];
}

export interface AiFlashcardsRequestMetadata {
  company?: string;
  period?: string;
  date?: string;
  source_url?: string;
}

export interface AiFlashcardsRequest {
  documentText: string;
  metadata?: AiFlashcardsRequestMetadata;
  externalSummaryText?: string;
  maxCards?: number;
}

export const FLASHCARD_TAGS: readonly FlashcardTag[];
export const FLASHCARD_DOC_TYPE: "concall_transcript";
