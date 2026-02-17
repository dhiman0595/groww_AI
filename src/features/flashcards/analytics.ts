type FlashcardsAnalyticsEvent =
  | "flashcards_generate_clicked"
  | "flashcards_generate_success"
  | "flashcards_generate_error"
  | "flashcard_expand_evidence"
  | "flashcard_copy";

type AnalyticsPayload = Record<string, string | number | boolean | null | undefined>;

export function trackFlashcardsEvent(event: FlashcardsAnalyticsEvent, payload: AnalyticsPayload = {}): void {
  const detail = {
    event,
    timestamp: new Date().toISOString(),
    ...payload,
  };

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("groww_ai_analytics", {
        detail,
      })
    );
  }

  // Placeholder sink until production analytics pipeline is wired.
  console.info("[flashcards_analytics]", detail);
}
