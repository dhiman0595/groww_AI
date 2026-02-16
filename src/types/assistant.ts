export interface AssistantInput {
  company: string;
  sector: string;
  revenueGrowth?: number | null;
  roe?: number | null;
  debtToEquity?: number | null;
  fcfMargin?: number | null;
  pe?: number | null;
  pb?: number | null;
  roce?: number | null;
  contextNotes: string;
}

export interface AssistantFormState {
  company: string;
  sector: string;
  revenueGrowth: string;
  roe: string;
  debtToEquity: string;
  fcfMargin: string;
  pe: string;
  pb: string;
  roce: string;
  contextNotes: string;
}

export type AssistantNumericField =
  | "revenueGrowth"
  | "roe"
  | "debtToEquity"
  | "fcfMargin"
  | "pe"
  | "pb"
  | "roce";

export type AssistantExtractedMetrics = Partial<Record<AssistantNumericField, number>>;

export interface AssistantOutput {
  snapshot: string;
  bullCase: string[];
  bearCase: string[];
  monitorables: string[];
}

export interface GuardrailWarning {
  field: keyof AssistantInput;
  message: string;
  severity: "info" | "warn";
}

export interface UrlValidationResult {
  isValid: boolean;
  error?: string;
}
