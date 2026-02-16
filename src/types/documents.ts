import type { AssistantExtractedMetrics } from "@/types/assistant";

export type DocumentKind = "quarterly" | "annual" | "drhp" | "announcement" | "concall" | "other";

export type DocumentSource = "pdf" | "csv" | "text" | "manual";

export interface QuarterlyRow {
  period: string;
  revenue?: number;
  profit?: number;
  eps?: number;
  sourceDocId: string;
}

export interface DocumentRecord {
  id: string;
  name: string;
  kind: DocumentKind;
  source: DocumentSource;
  content: string;
  createdAt: string;
  metrics: AssistantExtractedMetrics;
  quarterlyRows: QuarterlyRow[];
}

export interface DocumentAnswer {
  answer: string;
  sources: string[];
}

export interface DocumentChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}
