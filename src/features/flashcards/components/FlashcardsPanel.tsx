import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Copy, RefreshCcw, Share2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CompanyDocument } from "@/features/documents/types";
import { trackFlashcardsEvent } from "@/features/flashcards/analytics";
import {
  fetchDocumentTextFromSource,
  generateAiFlashcards,
  toShareableFlashcardText,
} from "@/features/flashcards/api/flashcardsClient";
import type {
  AiFlashcard,
  AiFlashcardsResponse,
  FlashcardTag,
  FlashcardsLoadingStage,
  FlashcardsSortMode,
} from "@/features/flashcards/types";

const TAG_FILTER_OPTIONS: Array<"ALL" | FlashcardTag> = [
  "ALL",
  "Strategy",
  "Financials",
  "Product",
  "Risk",
  "Regulation",
  "Operations",
  "Guidance",
];

const SORT_OPTIONS: FlashcardsSortMode[] = ["materiality", "confidence"];

interface FlashcardsPanelProps {
  symbol: string;
  companyName?: string;
  document: CompanyDocument | null;
  selectedYear?: string;
  onBack: () => void;
}

function buildPeriodLabel(document: CompanyDocument | null, selectedYear?: string): string {
  if (!document) {
    return selectedYear || "Latest period";
  }

  const parts = [document.quarter, document.fiscal_year, selectedYear]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  if (parts.length > 0) {
    return Array.from(new Set(parts)).join(" ");
  }

  return "Latest period";
}

function toConfidenceColor(confidence: number): string {
  if (confidence >= 0.85) {
    return "bg-emerald-500";
  }
  if (confidence >= 0.65) {
    return "bg-amber-500";
  }
  return "bg-rose-500";
}

function toLoadingMessage(stage: FlashcardsLoadingStage): string {
  if (stage === "reading") {
    return "Reading transcript...";
  }
  if (stage === "identifying") {
    return "Identifying themes...";
  }
  if (stage === "building") {
    return "Building cards...";
  }
  return "";
}

export function FlashcardsPanel({
  symbol,
  companyName,
  document,
  selectedYear,
  onBack,
}: FlashcardsPanelProps) {
  const [data, setData] = useState<AiFlashcardsResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [loadingStage, setLoadingStage] = useState<FlashcardsLoadingStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<"ALL" | FlashcardTag>("ALL");
  const [sortMode, setSortMode] = useState<FlashcardsSortMode>("materiality");
  const [expandedEvidenceIds, setExpandedEvidenceIds] = useState<Record<string, boolean>>({});
  const [copiedCardId, setCopiedCardId] = useState<string | null>(null);

  const debounceTimerRef = useRef<number | null>(null);
  const buildingTimerRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const materialityOrderRef = useRef<Record<string, number>>({});

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
      if (buildingTimerRef.current) {
        window.clearTimeout(buildingTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    setData(null);
    setStatus("idle");
    setError(null);
    setLoadingStage("idle");
    setExpandedEvidenceIds({});
    setCopiedCardId(null);
  }, [document?.id, symbol]);

  const filteredCards = useMemo(() => {
    if (!data) {
      return [];
    }

    const base = tagFilter === "ALL" ? [...data.cards] : data.cards.filter((card) => card.tag === tagFilter);
    if (sortMode === "confidence") {
      base.sort((left, right) => right.confidence - left.confidence);
      return base;
    }

    return base.sort((left, right) => {
      const leftIndex = materialityOrderRef.current[left.id] ?? 10_000;
      const rightIndex = materialityOrderRef.current[right.id] ?? 10_000;
      return leftIndex - rightIndex;
    });
  }, [data, sortMode, tagFilter]);

  function setLoadingStageWithTimers(nextStage: FlashcardsLoadingStage) {
    if (buildingTimerRef.current) {
      window.clearTimeout(buildingTimerRef.current);
      buildingTimerRef.current = null;
    }
    setLoadingStage(nextStage);
  }

  async function runGenerateFlashcards() {
    if (!document || !symbol) {
      setError("No document loaded. Select a company filing and try again.");
      setStatus("error");
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setStatus("loading");
    setError(null);
    setCopiedCardId(null);
    setLoadingStageWithTimers("reading");

    const sourceUrl = document.file_url || document.source_url;
    const period = buildPeriodLabel(document, selectedYear);
    trackFlashcardsEvent("flashcards_generate_clicked", {
      symbol,
      document_id: document.id,
      has_source_url: Boolean(sourceUrl),
    });

    try {
      const documentText = sourceUrl
        ? await fetchDocumentTextFromSource(
            {
              source_url: sourceUrl,
              fallback_text: document.description || "",
            },
            controller.signal
          )
        : document.description || "";

      if (!documentText || documentText.trim().length < 40) {
        throw new Error("Transcript text is unavailable for this filing.");
      }

      setLoadingStageWithTimers("identifying");
      buildingTimerRef.current = window.setTimeout(() => {
        setLoadingStage("building");
      }, 850);

      const response = await generateAiFlashcards(
        {
          documentText,
          metadata: {
            company: companyName || document.company_name || symbol,
            period,
            date: document.published_at,
            source_url: sourceUrl || undefined,
          },
          maxCards: 12,
        },
        controller.signal
      );

      if (buildingTimerRef.current) {
        window.clearTimeout(buildingTimerRef.current);
        buildingTimerRef.current = null;
      }
      materialityOrderRef.current = response.cards.reduce<Record<string, number>>((accumulator, card, index) => {
        accumulator[card.id] = index;
        return accumulator;
      }, {});

      setData(response);
      setStatus("success");
      setLoadingStage("idle");
      setExpandedEvidenceIds({});
      trackFlashcardsEvent("flashcards_generate_success", {
        symbol,
        document_id: document.id,
        card_count: response.cards.length,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }

      if (buildingTimerRef.current) {
        window.clearTimeout(buildingTimerRef.current);
        buildingTimerRef.current = null;
      }

      const message =
        err instanceof Error ? err.message : "Flashcards could not be generated right now. Please try again.";
      setStatus("error");
      setError(message);
      setLoadingStage("idle");
      trackFlashcardsEvent("flashcards_generate_error", {
        symbol,
        document_id: document.id,
        message: message.slice(0, 120),
      });
    }
  }

  function scheduleGenerate() {
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = window.setTimeout(() => {
      void runGenerateFlashcards();
    }, 240);
  }

  function handleEvidenceToggle(card: AiFlashcard) {
    setExpandedEvidenceIds((previous) => {
      const next = !previous[card.id];
      if (next) {
        trackFlashcardsEvent("flashcard_expand_evidence", {
          symbol,
          card_id: card.id,
          tag: card.tag,
        });
      }
      return {
        ...previous,
        [card.id]: next,
      };
    });
  }

  async function handleCopyCard(card: AiFlashcard) {
    const text = toShareableFlashcardText(card);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCardId(card.id);
      trackFlashcardsEvent("flashcard_copy", {
        symbol,
        card_id: card.id,
      });
      window.setTimeout(() => {
        setCopiedCardId((previous) => (previous === card.id ? null : previous));
      }, 1400);
    } catch {
      setCopiedCardId(null);
    }
  }

  async function handleShareCard(card: AiFlashcard) {
    const text = toShareableFlashcardText(card);
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: card.title,
          text,
        });
        return;
      } catch {
        // Fall through to clipboard share.
      }
    }
    await handleCopyCard(card);
  }

  const loadingMessage = toLoadingMessage(loadingStage);

  return (
    <>
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2.5">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
          onClick={onBack}
        >
          <ArrowLeft className="size-3.5" />
          Back
        </button>
        <p className="line-clamp-1 max-w-[72%] text-xs font-medium text-slate-700">
          {document ? document.title : "AI Flashcards"}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-800">AI Flashcards</p>
              <p className="line-clamp-1 text-[11px] text-slate-500">
                {companyName || document?.company_name || symbol} • {buildPeriodLabel(document, selectedYear)}
              </p>
            </div>

            <Button type="button" size="sm" className="h-8 gap-1.5 px-3 text-xs" disabled={status === "loading" || !document} onClick={scheduleGenerate}>
              <Sparkles className="size-3.5" />
              {data ? "Regenerate" : "Generate Flashcards"}
            </Button>
          </div>

          {status === "loading" ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              {loadingMessage}
            </div>
          ) : null}

          {!document ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
              No doc loaded. Select a filing and click AI.
            </div>
          ) : null}

          {status === "error" ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <p>{error || "Something went wrong while generating flashcards."}</p>
              <Button type="button" variant="outline" className="mt-3 h-8 gap-1 px-2.5 text-xs" onClick={scheduleGenerate}>
                <RefreshCcw className="size-3.5" />
                Retry
              </Button>
            </div>
          ) : null}

          {data ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label htmlFor="flashcards-tag-filter" className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">Filter tag</span>
                  <select
                    id="flashcards-tag-filter"
                    value={tagFilter}
                    onChange={(event) => setTagFilter(event.target.value as "ALL" | FlashcardTag)}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                  >
                    {TAG_FILTER_OPTIONS.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag === "ALL" ? "All tags" : tag}
                      </option>
                    ))}
                  </select>
                </label>

                <label htmlFor="flashcards-sort-mode" className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">Sort</span>
                  <select
                    id="flashcards-sort-mode"
                    value={sortMode}
                    onChange={(event) => setSortMode(event.target.value as FlashcardsSortMode)}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                  >
                    {SORT_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option === "materiality" ? "Materiality" : "Confidence"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="space-y-2.5">
                {filteredCards.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-500">
                    No cards match this filter.
                  </div>
                ) : null}

                {filteredCards.map((card) => {
                  const isEvidenceExpanded = Boolean(expandedEvidenceIds[card.id]);
                  const confidencePct = Math.round(card.confidence * 100);
                  return (
                    <article key={card.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-900">{card.title}</h3>
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                          {card.tag}
                        </Badge>
                      </div>

                      <p className="mt-2 text-sm leading-relaxed text-slate-700">{card.summary}</p>

                      <button
                        type="button"
                        className="mt-2 text-xs font-medium text-emerald-700 hover:text-emerald-900"
                        onClick={() => handleEvidenceToggle(card)}
                      >
                        {isEvidenceExpanded ? "Hide Evidence" : "Show Evidence"}
                      </button>

                      {isEvidenceExpanded ? (
                        <ul className="mt-2 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700">
                          {card.evidence.map((line, index) => (
                            <li key={`${card.id}-evidence-${index}`} className="leading-relaxed">
                              - {line}
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      <div className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50/70 p-2.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Why it matters</p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-700">{card.implication}</p>
                      </div>

                      <div className="mt-2">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                          <span>Confidence</span>
                          <span>{confidencePct}%</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-200">
                          <div
                            className={`h-1.5 rounded-full ${toConfidenceColor(card.confidence)}`}
                            style={{ width: `${confidencePct}%` }}
                          />
                        </div>
                      </div>

                      <div className="mt-3 flex items-center gap-1.5">
                        <Button type="button" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => void handleCopyCard(card)}>
                          <Copy className="mr-1 size-3.5" />
                          {copiedCardId === card.id ? "Copied" : "Copy"}
                        </Button>
                        <Button type="button" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => void handleShareCard(card)}>
                          <Share2 className="mr-1 size-3.5" />
                          Share
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
