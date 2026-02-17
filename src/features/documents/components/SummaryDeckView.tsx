import type { PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Layers3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ChatSource, SummaryCard } from "@/features/documents/api/chatClient";

interface SummaryDeckStateView {
  cards: SummaryCard[];
  currentIndex: number;
  isLoading: boolean;
  error: string | null;
}

interface SummaryDeckViewProps {
  summaryDocumentTitle?: string;
  activeSummaryDeck: SummaryDeckStateView;
  currentSummaryCard: SummaryCard | null;
  summarySources: ChatSource[];
  dragOffsetX: number;
  dragStartX: number | null;
  onBack: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onRequestLeft: () => void;
  onRequestRight: () => void;
}

export function SummaryDeckView({
  summaryDocumentTitle,
  activeSummaryDeck,
  currentSummaryCard,
  summarySources,
  dragOffsetX,
  dragStartX,
  onBack,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
  onRequestLeft,
  onRequestRight,
}: SummaryDeckViewProps) {
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
          {summaryDocumentTitle || "Document summary"}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-3">
          {activeSummaryDeck.error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              {activeSummaryDeck.error}
            </div>
          ) : null}

          {!currentSummaryCard && activeSummaryDeck.isLoading ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Building your first knowledge card...
            </div>
          ) : null}

          {currentSummaryCard ? (
            <>
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Layers3 className="size-3.5" />
                  Knowledge cards
                </span>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  Depth level {currentSummaryCard.level}/5
                </span>
              </div>

              <div className="relative pb-2 pt-4">
                <div className="pointer-events-none absolute inset-x-6 top-1 h-[92%] rounded-2xl border border-slate-200 bg-white/75 shadow-sm" />
                <div className="pointer-events-none absolute inset-x-3 top-2 h-[95%] rounded-2xl border border-slate-200 bg-white/90 shadow-sm" />

                <article
                  className="relative z-10 select-none rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  style={{
                    transform: `translateX(${dragOffsetX}px) rotate(${dragOffsetX / 24}deg)`,
                    transition: dragStartX === null ? "transform 180ms ease" : "none",
                    touchAction: "pan-y",
                  }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerEnd}
                  onPointerCancel={onPointerEnd}
                >
                  <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                    Left: alternate lens
                  </div>
                  <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    Right: go deeper
                  </div>

                  <div className="pt-7">
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                      {currentSummaryCard.concept}
                    </Badge>
                    <h3 className="mt-2 text-base font-semibold text-slate-900">{currentSummaryCard.title}</h3>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {currentSummaryCard.explanation}
                    </p>

                    <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/60 p-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                        Why it matters
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-700">{currentSummaryCard.why_it_matters}</p>
                    </div>

                    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Example</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-700">{currentSummaryCard.example}</p>
                    </div>
                  </div>
                </article>

                <div className="mt-3 flex items-center justify-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 border-rose-200 text-rose-700 hover:bg-rose-50"
                    disabled={activeSummaryDeck.isLoading}
                    onClick={onRequestLeft}
                    aria-label="Previous knowledge card perspective"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <span className="text-[11px] text-slate-500">Use arrows or swipe</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    disabled={activeSummaryDeck.isLoading}
                    onClick={onRequestRight}
                    aria-label="Next deeper knowledge card"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>

              {summarySources.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {summarySources.slice(0, 8).map((source, index) => {
                    const hasLink = source.url && source.url.length > 0;
                    const label = source.title || source.source_name || "Source";
                    const key = `${label}-${source.url || index}`;

                    return hasLink ? (
                      <a
                        key={key}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-800"
                      >
                        {label}
                      </a>
                    ) : (
                      <span
                        key={key}
                        className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600"
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : null}

          {currentSummaryCard && activeSummaryDeck.isLoading ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Generating next card...
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
