import type {
  AiFlashcard,
  AiFlashcardEvidence,
  AiFlashcardsRequest,
  AiFlashcardsResponse,
  FlashcardTag,
} from "@/features/flashcards/types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
const ALLOWED_TAGS: FlashcardTag[] = [
  "Financials",
  "Product",
  "Strategy",
  "Operations",
  "Risk",
  "Regulation",
  "Guidance",
];

function withBaseUrl(pathname: string): string {
  if (!API_BASE_URL) {
    return pathname;
  }
  return `${API_BASE_URL.replace(/\/$/, "")}${pathname}`;
}

function toErrorMessage(defaultMessage: string, payload: unknown): string {
  if (payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string") {
    return (payload as { error: string }).error;
  }
  return defaultMessage;
}

function normalizeCard(card: unknown): AiFlashcard | null {
  if (!card || typeof card !== "object") {
    return null;
  }
  const value = card as Record<string, unknown>;
  const tag = typeof value.tag === "string" && ALLOWED_TAGS.includes(value.tag as FlashcardTag) ? (value.tag as FlashcardTag) : "Operations";
  const evidence = Array.isArray(value.evidence)
    ? value.evidence
        .map((item): AiFlashcardEvidence | null => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const entry = item as Record<string, unknown>;
          const type = entry.type === "metric" || entry.type === "quote" ? entry.type : null;
          const text = typeof entry.text === "string" ? entry.text.trim() : "";
          const sourceRefRaw = typeof entry.source_ref === "string" ? entry.source_ref.trim().toLowerCase() : "";
          if (!type || text.length < 8 || !/^p\d{1,4}$/.test(sourceRefRaw)) {
            return null;
          }
          return {
            type,
            text: text.slice(0, 320),
            source_ref: sourceRefRaw,
          };
        })
        .filter((item): item is AiFlashcardEvidence => Boolean(item))
        .slice(0, 6)
    : [];
  if (evidence.length < 2 || !Array.isArray(evidence)) {
    return null;
  }

  const confidenceRaw = Number(value.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.7;

  const title = typeof value.title === "string" ? value.title.trim() : "";
  const summary = typeof value.summary === "string" ? value.summary.trim() : "";
  const whyItMatters = typeof value.why_it_matters === "string" ? value.why_it_matters.trim() : "";
  if (!title || !summary || !whyItMatters) {
    return null;
  }

  return {
    id: typeof value.id === "string" ? value.id : `${crypto.randomUUID()}`,
    title: title.slice(0, 90),
    tag,
    summary,
    evidence: evidence as [AiFlashcardEvidence, ...AiFlashcardEvidence[]],
    why_it_matters: whyItMatters,
    confidence,
  };
}

function normalizeResponse(payload: unknown): AiFlashcardsResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("Malformed flashcards response.");
  }

  const value = payload as Record<string, unknown>;
  const meta = value.meta as Record<string, unknown> | undefined;
  if (!meta || typeof meta !== "object") {
    throw new Error("Malformed flashcards response meta.");
  }

  const cards = Array.isArray(value.cards) ? value.cards.map((card) => normalizeCard(card)).filter((card): card is AiFlashcard => Boolean(card)) : [];
  if (cards.length === 0) {
    throw new Error("Malformed flashcards response cards.");
  }

  return {
    meta: {
      company: typeof meta.company === "string" ? meta.company : "Unknown company",
      period: typeof meta.period === "string" ? meta.period : "Latest period",
      doc_type: "concall_transcript",
      generated_at:
        typeof meta.generated_at === "string" && !Number.isNaN(new Date(meta.generated_at).getTime())
          ? meta.generated_at
          : new Date().toISOString(),
    },
    cards,
  };
}

export async function fetchDocumentTextFromSource(
  payload: {
    source_url: string;
    fallback_text?: string;
  },
  signal?: AbortSignal
): Promise<string> {
  const endpoint = withBaseUrl("/api/ai/document-text");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      // Keep default message when parsing fails.
    }
    throw new Error(toErrorMessage("Failed to read transcript text.", parsed));
  }

  const parsed = (await response.json()) as { document_text?: unknown };
  if (typeof parsed.document_text !== "string" || parsed.document_text.trim().length === 0) {
    throw new Error("Transcript text is empty.");
  }

  return parsed.document_text.trim();
}

export async function generateAiFlashcards(payload: AiFlashcardsRequest, signal?: AbortSignal): Promise<AiFlashcardsResponse> {
  const endpoint = withBaseUrl("/api/ai/flashcards");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      // Keep fallback message.
    }
    throw new Error(toErrorMessage("Failed to generate AI flashcards.", parsed));
  }

  const parsed = await response.json();
  return normalizeResponse(parsed);
}

export function toShareableFlashcardText(card: AiFlashcard): string {
  const evidence = card.evidence.map((item) => `- [${item.source_ref}] (${item.type}) ${item.text}`).join("\n");
  return [
    `${card.title} (${card.tag})`,
    "",
    card.summary,
    "",
    "Evidence:",
    evidence,
    "",
    `Why it matters: ${card.why_it_matters}`,
    "",
    `Confidence: ${(card.confidence * 100).toFixed(0)}%`,
  ].join("\n");
}
