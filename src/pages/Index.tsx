import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, SendHorizontal, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchChatAnswer, type ChatSource } from "@/features/documents/api/chatClient";
import { CompanySelector } from "@/features/documents/components/CompanySelector";
import { useCompaniesQuery } from "@/features/documents/state/useCompaniesQuery";
import { useDocumentsQuery } from "@/features/documents/state/useDocumentsQuery";
import type { CompanyDocument } from "@/features/documents/types";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: ChatSource[];
}

interface ChatSessionState {
  messages: ChatMessage[];
  followUpQuestions: string[];
}

interface SummaryViewState {
  docId: string;
}

const ROW_DOC_TYPES = new Set<CompanyDocument["doc_type"]>([
  "CONCALL_TRANSCRIPT",
  "QUARTERLY_RESULT",
  "DRHP",
  "RHP",
  "OFFER_DOCUMENT",
]);

function createEmptySession(): ChatSessionState {
  return {
    messages: [],
    followUpQuestions: [],
  };
}

function createMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeYearValue(value: string): string {
  return value.trim().toUpperCase();
}

function inferYearOption(document: CompanyDocument): string | null {
  if (document.fiscal_year?.trim()) {
    return normalizeYearValue(document.fiscal_year);
  }

  const date = new Date(document.published_at);
  if (!Number.isNaN(date.getTime())) {
    return `${date.getFullYear()}`;
  }

  return null;
}

function extractYearScore(value: string): number {
  const fiscalYearMatch = value.match(/FY\s*(\d{2,4})/i);
  if (fiscalYearMatch?.[1]) {
    let year = Number(fiscalYearMatch[1]);
    if (year < 100) {
      year += 2000;
    }
    return year;
  }

  const yearMatch = value.match(/\b(19|20)\d{2}\b/);
  if (yearMatch?.[0]) {
    return Number(yearMatch[0]);
  }

  return 0;
}

function matchesYear(document: CompanyDocument, selectedYear: string): boolean {
  if (!selectedYear || selectedYear === "ALL") {
    return true;
  }

  const normalizedSelection = normalizeYearValue(selectedYear);
  const fiscalYear = normalizeYearValue(document.fiscal_year ?? "");
  if (fiscalYear && fiscalYear.includes(normalizedSelection)) {
    return true;
  }

  const published = new Date(document.published_at);
  if (!Number.isNaN(published.getTime())) {
    const publishedYear = `${published.getFullYear()}`;
    if (normalizedSelection.includes(publishedYear) || publishedYear.includes(normalizedSelection)) {
      return true;
    }
  }

  return false;
}

function formatDocType(type: CompanyDocument["doc_type"]): string {
  switch (type) {
    case "CONCALL_TRANSCRIPT":
      return "Concall";
    case "QUARTERLY_RESULT":
      return "Quarterly";
    case "DRHP":
      return "DRHP";
    case "RHP":
      return "RHP";
    case "OFFER_DOCUMENT":
      return "Offer";
    case "ANNOUNCEMENT":
      return "Announcement";
    case "INVESTOR_PRESENTATION":
      return "Presentation";
    default:
      return "Other";
  }
}

function formatPublishedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function truncateSuggestion(text: string, maxLength = 54): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function pickDocumentUrl(document: CompanyDocument): string {
  return document.file_url || document.source_url;
}

function pickTranscriptUrl(document: CompanyDocument): string {
  if (document.doc_type !== "CONCALL_TRANSCRIPT") {
    return "";
  }

  return document.file_url || document.source_url;
}

function toSummarySessionKey(symbol: string, docId: string): string {
  return `${symbol}::${docId}`;
}

export function IndexPage() {
  const [companySearchText, setCompanySearchText] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [draftQuestion, setDraftQuestion] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [isSummaryAsking, setIsSummaryAsking] = useState(false);
  const [sessionsBySymbol, setSessionsBySymbol] = useState<Record<string, ChatSessionState>>({});
  const [summarySessionsByKey, setSummarySessionsByKey] = useState<Record<string, ChatSessionState>>({});
  const [selectedYearBySymbol, setSelectedYearBySymbol] = useState<Record<string, string>>({});
  const [selectedDocIdBySymbol, setSelectedDocIdBySymbol] = useState<Record<string, string>>({});
  const [summaryView, setSummaryView] = useState<SummaryViewState | null>(null);

  const companiesQuery = useCompaniesQuery(companySearchText);
  const effectiveSelectedSymbol = selectedSymbol.trim().toUpperCase();

  const selectedCompany = useMemo(
    () =>
      companiesQuery.data.find((company) => company.symbol === effectiveSelectedSymbol) ??
      (effectiveSelectedSymbol
        ? {
            symbol: effectiveSelectedSymbol,
            company_name: effectiveSelectedSymbol,
          }
        : null),
    [companiesQuery.data, effectiveSelectedSymbol]
  );

  const documentsQuery = useDocumentsQuery({
    symbol: effectiveSelectedSymbol,
    page: 1,
    page_size: 120,
  });

  const companyDocuments = documentsQuery.data.items;

  const yearOptions = useMemo(() => {
    const uniqueYears = Array.from(
      new Set(companyDocuments.map((document) => inferYearOption(document)).filter((value): value is string => Boolean(value)))
    );

    return uniqueYears.sort((left, right) => {
      const scoreDiff = extractYearScore(right) - extractYearScore(left);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return right.localeCompare(left, "en", { sensitivity: "base" });
    });
  }, [companyDocuments]);

  useEffect(() => {
    if (!effectiveSelectedSymbol || yearOptions.length === 0) {
      return;
    }

    setSelectedYearBySymbol((previous) => {
      if (previous[effectiveSelectedSymbol]) {
        return previous;
      }

      return {
        ...previous,
        [effectiveSelectedSymbol]: yearOptions[0],
      };
    });
  }, [effectiveSelectedSymbol, yearOptions]);

  useEffect(() => {
    setSummaryView(null);
    setSummaryDraft("");
  }, [effectiveSelectedSymbol]);

  const selectedYear = selectedYearBySymbol[effectiveSelectedSymbol] ?? "ALL";
  const filteredByYear = useMemo(
    () => companyDocuments.filter((document) => matchesYear(document, selectedYear)),
    [companyDocuments, selectedYear]
  );

  const documentRows = useMemo(() => {
    const scoped = filteredByYear.filter((document) => ROW_DOC_TYPES.has(document.doc_type));
    const source = scoped.length > 0 ? scoped : filteredByYear;

    return [...source].sort((left, right) => {
      const leftTs = new Date(left.published_at).getTime();
      const rightTs = new Date(right.published_at).getTime();
      return rightTs - leftTs;
    });
  }, [filteredByYear]);

  const selectedDocId = selectedDocIdBySymbol[effectiveSelectedSymbol] ?? "";
  const selectedChatDocument = useMemo(
    () => documentRows.find((document) => document.id === selectedDocId) ?? null,
    [documentRows, selectedDocId]
  );

  useEffect(() => {
    if (!selectedDocId) {
      return;
    }

    const isStillAvailable = documentRows.some((document) => document.id === selectedDocId);
    if (isStillAvailable) {
      return;
    }

    setSelectedDocIdBySymbol((previous) => ({
      ...previous,
      [effectiveSelectedSymbol]: "",
    }));
  }, [documentRows, effectiveSelectedSymbol, selectedDocId]);

  const activeSession = sessionsBySymbol[effectiveSelectedSymbol] ?? createEmptySession();
  const hasStartedChat = activeSession.messages.some((message) => message.role === "user");

  const initialSuggestions = useMemo(() => {
    if (!selectedCompany) {
      return [];
    }

    return [
      `Give me a beginner-friendly summary of ${selectedCompany.company_name}.`,
      `Explain ${selectedCompany.company_name}'s business model in plain language.`,
      `What are the biggest risks for ${selectedCompany.symbol} right now?`,
      `Break down the latest quarterly numbers and what they signal.`,
      `Which management comments are supported by the reported numbers?`,
      `What financial metrics should a beginner track for this stock?`,
      `Check if growth, margins, and cash flow trends are consistent.`,
      `What could go wrong over the next 3 years for this business?`,
      `Give me a long-term monitorables checklist for this company.`,
    ];
  }, [selectedCompany]);

  const contextualSuggestions = useMemo(() => {
    if (activeSession.followUpQuestions.length > 0) {
      return activeSession.followUpQuestions;
    }

    if (!selectedCompany) {
      return [];
    }

    const selectedPeriod = selectedYear !== "ALL" ? selectedYear : "latest period";
    return [
      `Compare ${selectedPeriod} with the prior period and explain the key changes.`,
      "Which management claims are backed by numbers and which are still assumptions?",
      "What red flags are still unresolved based on current disclosures?",
      "What should I track next quarter before updating the thesis?",
    ];
  }, [activeSession.followUpQuestions, selectedCompany, selectedYear]);

  const summarySessionKey = summaryView
    ? toSummarySessionKey(effectiveSelectedSymbol, summaryView.docId)
    : "";
  const activeSummarySession =
    summarySessionKey.length > 0
      ? summarySessionsByKey[summarySessionKey] ?? createEmptySession()
      : createEmptySession();

  const summaryDocument = useMemo(() => {
    if (!summaryView) {
      return null;
    }
    return documentRows.find((document) => document.id === summaryView.docId) ?? null;
  }, [documentRows, summaryView]);

  async function submitMainQuestion(rawQuestion: string, options?: { docIds?: string[] }) {
    if (!effectiveSelectedSymbol || isAsking) {
      return;
    }

    const question = rawQuestion.trim();
    if (!question) {
      return;
    }

    const currentSession = sessionsBySymbol[effectiveSelectedSymbol] ?? createEmptySession();
    const conversationHistory = [
      ...currentSession.messages.slice(-6).map((message) => ({
        role: message.role,
        content: message.content,
      })),
      {
        role: "user" as const,
        content: question,
      },
    ];

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: question,
      sources: [],
    };

    setSessionsBySymbol((previous) => {
      const existing = previous[effectiveSelectedSymbol] ?? createEmptySession();
      return {
        ...previous,
        [effectiveSelectedSymbol]: {
          ...existing,
          messages: [...existing.messages, userMessage],
        },
      };
    });

    setDraftQuestion("");
    setIsAsking(true);

    try {
      const scopedDocIds = options?.docIds?.length
        ? options.docIds
        : selectedChatDocument
          ? [selectedChatDocument.id]
          : undefined;

      const response = await fetchChatAnswer({
        symbol: effectiveSelectedSymbol,
        company_name: selectedCompany?.company_name,
        question,
        year: selectedYear === "ALL" ? undefined : selectedYear,
        doc_ids: scopedDocIds,
        history: conversationHistory,
      });

      const assistantMessage: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        content: response.answer,
        sources: response.sources,
      };

      setSessionsBySymbol((previous) => {
        const existing = previous[effectiveSelectedSymbol] ?? createEmptySession();
        return {
          ...previous,
          [effectiveSelectedSymbol]: {
            messages: [...existing.messages, assistantMessage],
            followUpQuestions:
              response.follow_up_questions.length > 0
                ? response.follow_up_questions
                : existing.followUpQuestions,
          },
        };
      });
    } catch (error) {
      const assistantMessage: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        content:
          error instanceof Error
            ? error.message
            : "I could not process that query right now. Please retry in a few seconds.",
        sources: [],
      };

      setSessionsBySymbol((previous) => {
        const existing = previous[effectiveSelectedSymbol] ?? createEmptySession();
        return {
          ...previous,
          [effectiveSelectedSymbol]: {
            ...existing,
            messages: [...existing.messages, assistantMessage],
          },
        };
      });
    } finally {
      setIsAsking(false);
    }
  }

  async function openSummaryView(document: CompanyDocument) {
    if (!effectiveSelectedSymbol || isSummaryAsking) {
      setSummaryView({ docId: document.id });
      return;
    }

    setSummaryView({ docId: document.id });
    setSummaryDraft("");

    const nextSessionKey = toSummarySessionKey(effectiveSelectedSymbol, document.id);
    const existing = summarySessionsByKey[nextSessionKey];
    if (existing && existing.messages.length > 0) {
      return;
    }

    setIsSummaryAsking(true);

    try {
      const response = await fetchChatAnswer({
        symbol: effectiveSelectedSymbol,
        company_name: selectedCompany?.company_name,
        question:
          "Give me a deep summary of this selected document. Include business model, key metrics, management commentary versus numbers, risks, and what is often ignored.",
        year: selectedYear === "ALL" ? undefined : selectedYear,
        doc_ids: [document.id],
        history: [],
      });

      const assistantMessage: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        content: response.answer,
        sources: response.sources,
      };

      setSummarySessionsByKey((previous) => ({
        ...previous,
        [nextSessionKey]: {
          messages: [assistantMessage],
          followUpQuestions: response.follow_up_questions,
        },
      }));
    } catch (error) {
      const assistantMessage: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        content:
          error instanceof Error
            ? error.message
            : "Could not load summary for this document right now.",
        sources: [],
      };

      setSummarySessionsByKey((previous) => ({
        ...previous,
        [nextSessionKey]: {
          messages: [assistantMessage],
          followUpQuestions: [],
        },
      }));
    } finally {
      setIsSummaryAsking(false);
    }
  }

  async function submitSummaryQuestion(rawQuestion: string) {
    if (!effectiveSelectedSymbol || !summaryView || isSummaryAsking) {
      return;
    }

    const question = rawQuestion.trim();
    if (!question) {
      return;
    }

    const currentSession = summarySessionsByKey[summarySessionKey] ?? createEmptySession();
    const conversationHistory = [
      ...currentSession.messages.slice(-6).map((message) => ({
        role: message.role,
        content: message.content,
      })),
      {
        role: "user" as const,
        content: question,
      },
    ];

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: question,
      sources: [],
    };

    setSummarySessionsByKey((previous) => {
      const existing = previous[summarySessionKey] ?? createEmptySession();
      return {
        ...previous,
        [summarySessionKey]: {
          ...existing,
          messages: [...existing.messages, userMessage],
        },
      };
    });

    setSummaryDraft("");
    setIsSummaryAsking(true);

    try {
      const response = await fetchChatAnswer({
        symbol: effectiveSelectedSymbol,
        company_name: selectedCompany?.company_name,
        question,
        year: selectedYear === "ALL" ? undefined : selectedYear,
        doc_ids: [summaryView.docId],
        history: conversationHistory,
      });

      const assistantMessage: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        content: response.answer,
        sources: response.sources,
      };

      setSummarySessionsByKey((previous) => {
        const existing = previous[summarySessionKey] ?? createEmptySession();
        return {
          ...previous,
          [summarySessionKey]: {
            messages: [...existing.messages, assistantMessage],
            followUpQuestions:
              response.follow_up_questions.length > 0
                ? response.follow_up_questions
                : existing.followUpQuestions,
          },
        };
      });
    } catch (error) {
      const assistantMessage: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        content:
          error instanceof Error
            ? error.message
            : "Could not answer this summary question right now.",
        sources: [],
      };

      setSummarySessionsByKey((previous) => {
        const existing = previous[summarySessionKey] ?? createEmptySession();
        return {
          ...previous,
          [summarySessionKey]: {
            ...existing,
            messages: [...existing.messages, assistantMessage],
          },
        };
      });
    } finally {
      setIsSummaryAsking(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 px-2 py-3">
      <div className="mx-auto w-full max-w-[430px]">
        <Card className="flex h-[95vh] flex-col overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_24px_70px_-28px_rgba(15,23,42,0.55)]">
          <header className="space-y-3 border-b border-slate-200 px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                <Sparkles className="size-4 text-emerald-600" />
                Groww AI
              </h1>
              <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                Chat with filings
              </Badge>
            </div>

            <CompanySelector
              companies={companiesQuery.data}
              selectedSymbol={selectedSymbol}
              searchText={companySearchText}
              onSearchTextChange={setCompanySearchText}
              onSelectSymbol={(symbol) => {
                setSelectedSymbol(symbol);
                const company = companiesQuery.data.find((item) => item.symbol === symbol);
                if (company) {
                  setCompanySearchText(company.company_name);
                }
              }}
              isLoading={companiesQuery.isLoading}
              error={companiesQuery.error}
            />

            {selectedCompany ? (
              <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="space-y-1">
                  <Label htmlFor="fy-selection" className="text-xs text-slate-600">
                    Financial year (FY)
                  </Label>
                  <select
                    id="fy-selection"
                    value={selectedYear}
                    onChange={(event) =>
                      setSelectedYearBySymbol((previous) => ({
                        ...previous,
                        [effectiveSelectedSymbol]: event.target.value,
                      }))
                    }
                    className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                  >
                    <option value="ALL">All FY</option>
                    {yearOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-600">
                    Filings feed (Concall / Quarterly / DRHP-RHP)
                  </p>
                  <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                    {documentsQuery.isLoading ? (
                      <p className="text-xs text-slate-500">Loading filings...</p>
                    ) : null}
                    {documentsQuery.error ? (
                      <p className="text-xs text-rose-600">{documentsQuery.error}</p>
                    ) : null}

                    {!documentsQuery.isLoading && !documentsQuery.error && documentRows.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-2.5 text-xs text-slate-500">
                        No filings found for the selected FY.
                      </div>
                    ) : null}

                    {documentRows.map((document) => {
                      const transcriptUrl = pickTranscriptUrl(document);
                      const documentUrl = pickDocumentUrl(document);
                      const isSelectedForChat = selectedChatDocument?.id === document.id;

                      return (
                        <article
                          key={document.id}
                          className={`cursor-pointer rounded-lg border p-2.5 ${
                            isSelectedForChat
                              ? "border-emerald-300 bg-emerald-50/40"
                              : "border-slate-200 bg-white"
                          }`}
                          onClick={() => {
                            setSelectedDocIdBySymbol((previous) => ({
                              ...previous,
                              [effectiveSelectedSymbol]:
                                previous[effectiveSelectedSymbol] === document.id ? "" : document.id,
                            }));
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-900">{document.title}</p>
                              <p className="text-[11px] text-slate-500">
                                {formatDocType(document.doc_type)}
                                {document.quarter ? ` • ${document.quarter}` : ""}
                                {document.fiscal_year ? ` • ${document.fiscal_year}` : ""}
                              </p>
                              <p className="text-[11px] text-slate-500">{formatPublishedAt(document.published_at)}</p>
                            </div>
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              {document.exchange ?? "OTHER"}
                            </Badge>
                          </div>

                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              disabled={isAsking}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedDocIdBySymbol((previous) => ({
                                  ...previous,
                                  [effectiveSelectedSymbol]: document.id,
                                }));
                                void submitMainQuestion(
                                  `Give me a risk-reward checklist and monitorables from "${document.title}" in simple language.`,
                                  { docIds: [document.id] }
                                );
                              }}
                            >
                              Rec
                            </Button>

                            <Button
                              type="button"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              disabled={!transcriptUrl}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!transcriptUrl) {
                                  return;
                                }
                                window.open(transcriptUrl, "_blank", "noopener,noreferrer");
                              }}
                            >
                              Transcript
                            </Button>

                            {documentUrl ? (
                              <Button
                                type="button"
                                variant="outline"
                                className="h-7 px-2 text-[11px]"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  window.open(documentUrl, "_blank", "noopener,noreferrer");
                                }}
                              >
                                Document
                              </Button>
                            ) : null}

                            <Button
                              type="button"
                              variant="outline"
                              className="h-7 border-emerald-300 px-2 text-[11px] text-emerald-700 hover:bg-emerald-50"
                              disabled={isSummaryAsking}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedDocIdBySymbol((previous) => ({
                                  ...previous,
                                  [effectiveSelectedSymbol]: document.id,
                                }));
                                void openSummaryView(document);
                              }}
                            >
                              AI Summary
                            </Button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}
          </header>

          <div className="flex min-h-0 flex-1 flex-col bg-slate-50/40">
            {!selectedCompany ? (
              <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-slate-500">
                Select a company to start chat and filing analysis.
              </div>
            ) : summaryView ? (
              <>
                <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2.5">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                    onClick={() => setSummaryView(null)}
                  >
                    <ArrowLeft className="size-3.5" />
                    Back
                  </button>
                  <p className="line-clamp-1 max-w-[72%] text-xs font-medium text-slate-700">
                    {summaryDocument?.title ?? "Document summary"}
                  </p>
                </div>

                {activeSummarySession.followUpQuestions.length > 0 ? (
                  <div className="border-b border-slate-200 bg-white px-3 py-2">
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {activeSummarySession.followUpQuestions.map((suggestion) => (
                        <div key={suggestion} className="group relative shrink-0">
                          <button
                            type="button"
                            className="h-8 rounded-full border border-slate-200 bg-white px-3 text-xs text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700"
                            disabled={isSummaryAsking}
                            onClick={() => {
                              void submitSummaryQuestion(suggestion);
                            }}
                          >
                            {truncateSuggestion(suggestion)}
                          </button>
                          <div className="pointer-events-none absolute left-1/2 top-0 z-20 hidden w-64 -translate-x-1/2 -translate-y-[110%] rounded-lg border border-emerald-100 bg-emerald-50 p-2 text-xs leading-relaxed text-slate-700 shadow-sm group-hover:block">
                            {suggestion}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                  <div className="space-y-3">
                    {activeSummarySession.messages.map((message) => (
                      <article
                        key={message.id}
                        className={`max-w-[86%] rounded-2xl p-3 text-sm shadow-sm ${
                          message.role === "user"
                            ? "ml-auto rounded-br-md bg-emerald-500 text-white"
                            : "mr-auto rounded-bl-md border border-slate-200 bg-white text-slate-800"
                        }`}
                      >
                        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                        {message.role === "assistant" && message.sources.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {message.sources.slice(0, 6).map((source) => {
                              const hasLink = source.url && source.url.length > 0;
                              const label = source.title || source.source_name || "Source";

                              return hasLink ? (
                                <a
                                  key={`${message.id}-${label}-${source.url}`}
                                  href={source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-800"
                                >
                                  {label}
                                </a>
                              ) : (
                                <span
                                  key={`${message.id}-${label}`}
                                  className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600"
                                >
                                  {label}
                                </span>
                              );
                            })}
                          </div>
                        ) : null}
                      </article>
                    ))}

                    {isSummaryAsking ? (
                      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        Thinking...
                      </div>
                    ) : null}
                  </div>
                </div>

                <form
                  className="border-t border-slate-200 bg-white p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitSummaryQuestion(summaryDraft);
                  }}
                >
                  <div className="flex items-end gap-2">
                    <Textarea
                      value={summaryDraft}
                      onChange={(event) => setSummaryDraft(event.target.value)}
                      placeholder="Ask questions about this AI summary..."
                      className="min-h-12 resize-none"
                      rows={2}
                    />
                    <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={isSummaryAsking}>
                      <SendHorizontal className="size-4" />
                    </Button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <div className="border-b border-slate-200 bg-white px-3 py-3">
                  {selectedChatDocument ? (
                    <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5">
                      <p className="line-clamp-1 text-[11px] text-emerald-800">
                        Scoped to filing: {selectedChatDocument.title}
                      </p>
                      <button
                        type="button"
                        className="text-[11px] font-medium text-emerald-700 hover:text-emerald-900"
                        onClick={() =>
                          setSelectedDocIdBySymbol((previous) => ({
                            ...previous,
                            [effectiveSelectedSymbol]: "",
                          }))
                        }
                      >
                        Clear
                      </button>
                    </div>
                  ) : null}

                  {!hasStartedChat ? (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-slate-600">Suggested questions</p>
                      <div className="grid grid-cols-3 gap-2">
                        {initialSuggestions.map((suggestion) => (
                          <Button
                            key={suggestion}
                            type="button"
                            variant="outline"
                            className="h-auto min-h-16 whitespace-normal px-2 py-2 text-left text-[11px] leading-relaxed"
                            disabled={isAsking}
                            onClick={() => {
                              void submitMainQuestion(suggestion);
                            }}
                          >
                            {suggestion}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-slate-600">Suggested follow-ups</p>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {contextualSuggestions.map((suggestion) => (
                          <div key={suggestion} className="group relative shrink-0">
                            <button
                              type="button"
                              className="h-8 rounded-full border border-slate-200 bg-white px-3 text-xs text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700"
                              disabled={isAsking}
                              onClick={() => {
                                void submitMainQuestion(suggestion);
                              }}
                            >
                              {truncateSuggestion(suggestion)}
                            </button>
                            <div className="pointer-events-none absolute left-1/2 top-0 z-20 hidden w-64 -translate-x-1/2 -translate-y-[110%] rounded-lg border border-emerald-100 bg-emerald-50 p-2 text-xs leading-relaxed text-slate-700 shadow-sm group-hover:block">
                              {suggestion}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                  <div className="space-y-3">
                    {activeSession.messages.map((message) => (
                      <article
                        key={message.id}
                        className={`max-w-[86%] rounded-2xl p-3 text-sm shadow-sm ${
                          message.role === "user"
                            ? "ml-auto rounded-br-md bg-emerald-500 text-white"
                            : "mr-auto rounded-bl-md border border-slate-200 bg-white text-slate-800"
                        }`}
                      >
                        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                        {message.role === "assistant" && message.sources.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {message.sources.slice(0, 6).map((source) => {
                              const hasLink = source.url && source.url.length > 0;
                              const label = source.title || source.source_name || "Source";

                              return hasLink ? (
                                <a
                                  key={`${message.id}-${label}-${source.url}`}
                                  href={source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-800"
                                >
                                  {label}
                                </a>
                              ) : (
                                <span
                                  key={`${message.id}-${label}`}
                                  className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600"
                                >
                                  {label}
                                </span>
                              );
                            })}
                          </div>
                        ) : null}
                      </article>
                    ))}

                    {isAsking ? (
                      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        Thinking...
                      </div>
                    ) : null}
                  </div>
                </div>

                <form
                  className="border-t border-slate-200 bg-white p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitMainQuestion(draftQuestion);
                  }}
                >
                  <div className="flex items-end gap-2">
                    <Textarea
                      value={draftQuestion}
                      onChange={(event) => setDraftQuestion(event.target.value)}
                      placeholder="Ask about business model, metrics, management commentary, or risks..."
                      className="min-h-12 resize-none"
                      rows={2}
                    />
                    <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={isAsking}>
                      <SendHorizontal className="size-4" />
                    </Button>
                  </div>
                </form>
              </>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
