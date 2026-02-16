import type {
  AssistantExtractedMetrics,
  AssistantFormState,
  AssistantInput,
  AssistantNumericField,
} from "@/types/assistant";

export const INITIAL_ASSISTANT_FORM: AssistantFormState = {
  company: "",
  sector: "",
  revenueGrowth: "",
  roe: "",
  debtToEquity: "",
  fcfMargin: "",
  pe: "",
  pb: "",
  roce: "",
  contextNotes: "",
};

const NUMERIC_FIELDS: AssistantNumericField[] = [
  "revenueGrowth",
  "roe",
  "debtToEquity",
  "fcfMargin",
  "pe",
  "pb",
  "roce",
];

export function toNullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

export function toAssistantInput(form: AssistantFormState): AssistantInput {
  return {
    company: form.company,
    sector: form.sector,
    revenueGrowth: toNullableNumber(form.revenueGrowth),
    roe: toNullableNumber(form.roe),
    debtToEquity: toNullableNumber(form.debtToEquity),
    fcfMargin: toNullableNumber(form.fcfMargin),
    pe: toNullableNumber(form.pe),
    pb: toNullableNumber(form.pb),
    roce: toNullableNumber(form.roce),
    contextNotes: form.contextNotes,
  };
}

export function applyExtractedMetrics(
  form: AssistantFormState,
  metrics: AssistantExtractedMetrics
): AssistantFormState {
  const nextForm: AssistantFormState = { ...form };

  for (const field of NUMERIC_FIELDS) {
    const value = metrics[field];
    if (value != null && Number.isFinite(value)) {
      nextForm[field] = value.toString();
    }
  }

  return nextForm;
}
