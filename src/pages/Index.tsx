import {
  useEffect,
  lazy,
  useMemo,
  Suspense,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChevronDown, ChevronUp, SendHorizontal, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchChatAnswer,
  fetchSummaryCardsInit,
  fetchSummaryCardsNext,
  type ChatSource,
  type SummaryCard,
} from "@/features/documents/api/chatClient";
import { CompanySelector } from "@/features/documents/components/CompanySelector";
import { useCompaniesQuery } from "@/features/documents/state/useCompaniesQuery";
import { useDocumentsQuery } from "@/features/documents/state/useDocumentsQuery";
import type { CompanyDocument, CompanyOption, DocumentTypeFilter } from "@/features/documents/types";
import { FlashcardsPanel } from "@/features/flashcards/components/FlashcardsPanel";
import { aiFlashcardsV1 } from "@/features/flashcards/featureFlags";

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

interface SummaryDeckState {
  cards: SummaryCard[];
  currentIndex: number;
  isLoading: boolean;
  error: string | null;
  sources: ChatSource[];
}

type IndexAccessMode = "registered" | "guest";

interface IndexPageProps {
  accessMode?: IndexAccessMode;
  onLogout?: () => void;
}

const ROW_DOC_TYPES = new Set<CompanyDocument["doc_type"]>([
  "CONCALL_TRANSCRIPT",
  "QUARTERLY_RESULT",
  "DRHP",
  "RHP",
  "OFFER_DOCUMENT",
]);
const SUMMARY_DECK_STORAGE_PREFIX = "summary-cards-v1";
const SWIPE_THRESHOLD = 70;
const CHAT_RENDER_LIMIT = 60;
const DEFAULT_FILINGS_DOC_TYPE: DocumentTypeFilter = "quarterly-result";
const FILINGS_DOC_TYPE_OPTIONS: Array<{ value: DocumentTypeFilter; label: string }> = [
  { value: "quarterly-result", label: "Quarterly Result" },
  { value: "earnings-transcript", label: "Earnings Transcript" },
  { value: "announcement", label: "Announcement" },
  { value: "investor-presentation", label: "Investor Presentation" },
  { value: "annual-report", label: "Annual Report" },
  { value: "ALL", label: "All documents" },
];

const SummaryDeckView = lazy(() =>
  import("@/features/documents/components/SummaryDeckView").then((module) => ({
    default: module.SummaryDeckView,
  }))
);

function createEmptySession(): ChatSessionState {
  return {
    messages: [],
    followUpQuestions: [],
  };
}

function createEmptyDeck(): SummaryDeckState {
  return {
    cards: [],
    currentIndex: 0,
    isLoading: false,
    error: null,
    sources: [],
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

function formatPublishedAt(value: string): string | null {
  const date = new Date(value);
  const ts = date.getTime();
  if (Number.isNaN(ts) || date.getFullYear() <= 1971) {
    return null;
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

function toSummaryDeckKey(symbol: string, docId: string): string {
  return `${SUMMARY_DECK_STORAGE_PREFIX}::${symbol}::${docId}`;
}

function sanitizeSummaryCard(card: SummaryCard): SummaryCard {
  return {
    id: `${card.id || createMessageId()}`,
    concept: `${card.concept || "Concept"}`.trim(),
    title: `${card.title || "Knowledge card"}`.trim(),
    explanation: `${card.explanation || ""}`.trim(),
    why_it_matters: `${card.why_it_matters || ""}`.trim(),
    example: `${card.example || ""}`.trim(),
    level: Math.max(1, Math.min(5, Number(card.level) || 1)),
    source_refs: Array.isArray(card.source_refs) ? card.source_refs : [],
  };
}

function loadDeckFromStorage(storageKey: string): SummaryDeckState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as {
      cards?: SummaryCard[];
      currentIndex?: number;
      sources?: ChatSource[];
    };

    const cards = Array.isArray(parsed.cards)
      ? parsed.cards.map((card) => sanitizeSummaryCard(card)).filter((card) => card.title && card.explanation)
      : [];

    if (cards.length === 0) {
      return null;
    }

    const index = Number.isFinite(parsed.currentIndex)
      ? Math.max(0, Math.min(cards.length - 1, Number(parsed.currentIndex)))
      : 0;

    return {
      cards,
      currentIndex: index,
      isLoading: false,
      error: null,
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    };
  } catch {
    return null;
  }
}

function persistDeck(storageKey: string, deck: SummaryDeckState): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        cards: deck.cards,
        currentIndex: deck.currentIndex,
        sources: deck.sources,
      })
    );
  } catch {
    // Persists best-effort without blocking the UI.
  }
}

function mergeUniqueCards(existingCards: SummaryCard[], incomingCards: SummaryCard[]): SummaryCard[] {
  const byId = new Set(existingCards.map((card) => card.id));
  const appended = incomingCards.filter((card) => !byId.has(card.id));
  return appended.length > 0 ? [...existingCards, ...appended] : existingCards;
}

export function IndexPage({ accessMode = "registered", onLogout }: IndexPageProps) {
  const isGuestMode = accessMode === "guest";
  const [companySearchText, setCompanySearchText] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [selectedCompaniesBySymbol, setSelectedCompaniesBySymbol] = useState<Record<string, CompanyOption>>({});
  const [draftQuestion, setDraftQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [sessionsBySymbol, setSessionsBySymbol] = useState<Record<string, ChatSessionState>>({});
  const [expandedChatBySymbol, setExpandedChatBySymbol] = useState<Record<string, boolean>>({});
  const [summaryDecksByKey, setSummaryDecksByKey] = useState<Record<string, SummaryDeckState>>({});
  const [selectedYearBySymbol, setSelectedYearBySymbol] = useState<Record<string, string>>({});
  const [selectedDocTypeBySymbol, setSelectedDocTypeBySymbol] = useState<Record<string, DocumentTypeFilter>>({});
  const [selectedDocIdBySymbol, setSelectedDocIdBySymbol] = useState<Record<string, string>>({});
  const [isFilingsPanelOpenBySymbol, setIsFilingsPanelOpenBySymbol] = useState<Record<string, boolean>>({});
  const [summaryView, setSummaryView] = useState<SummaryViewState | null>(null);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const [dragOffsetX, setDragOffsetX] = useState(0);

  const companiesQuery = useCompaniesQuery(companySearchText, {
    limit: isGuestMode ? 3 : undefined,
    minChars: 2,
    allowEmptyQuery: false,
  });
  const selectableCompanies = useMemo(
    () => (isGuestMode ? companiesQuery.data.slice(0, 3) : companiesQuery.data),
    [companiesQuery.data, isGuestMode]
  );
  const effectiveSelectedSymbol = selectedSymbol.trim().toUpperCase();

  const selectedCompany = useMemo(
    () =>
      selectableCompanies.find((company) => company.symbol === effectiveSelectedSymbol) ??
      selectedCompaniesBySymbol[effectiveSelectedSymbol] ??
      (!isGuestMode && effectiveSelectedSymbol
        ? {
            symbol: effectiveSelectedSymbol,
            company_name: effectiveSelectedSymbol,
          }
        : null),
    [effectiveSelectedSymbol, isGuestMode, selectableCompanies, selectedCompaniesBySymbol]
  );

  useEffect(() => {
    if (!isGuestMode || !effectiveSelectedSymbol) {
      return;
    }
    if (companySearchText.trim().length < 2) {
      return;
    }

    const stillAllowed = selectableCompanies.some((company) => company.symbol === effectiveSelectedSymbol);
    if (stillAllowed) {
      return;
    }

    setSelectedSymbol("");
    setCompanySearchText("");
  }, [companySearchText, effectiveSelectedSymbol, isGuestMode, selectableCompanies]);

  const selectedDocumentType = selectedDocTypeBySymbol[effectiveSelectedSymbol] ?? DEFAULT_FILINGS_DOC_TYPE;
  const documentsQuery = useDocumentsQuery({
    symbol: effectiveSelectedSymbol,
    doc_type: selectedDocumentType,
    page: 1,
    page_size: 20,
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
    if (!effectiveSelectedSymbol) {
      return;
    }

    setSelectedDocTypeBySymbol((previous) => {
      if (previous[effectiveSelectedSymbol]) {
        return previous;
      }

      return {
        ...previous,
        [effectiveSelectedSymbol]: DEFAULT_FILINGS_DOC_TYPE,
      };
    });
  }, [effectiveSelectedSymbol]);

  useEffect(() => {
    if (!effectiveSelectedSymbol) {
      return;
    }

    setIsFilingsPanelOpenBySymbol((previous) => {
      if (typeof previous[effectiveSelectedSymbol] === "boolean") {
        return previous;
      }

      return {
        ...previous,
        [effectiveSelectedSymbol]: false,
      };
    });
  }, [effectiveSelectedSymbol]);

  useEffect(() => {
    setSummaryView(null);
    setDragStartX(null);
    setDragOffsetX(0);
  }, [effectiveSelectedSymbol]);

  const selectedYear = selectedYearBySymbol[effectiveSelectedSymbol] ?? "ALL";
  const isFilingsPanelOpen = isFilingsPanelOpenBySymbol[effectiveSelectedSymbol] ?? false;
  const filteredByYear = useMemo(
    () => companyDocuments.filter((document) => matchesYear(document, selectedYear)),
    [companyDocuments, selectedYear]
  );

  const documentRows = useMemo(() => {
    const scoped = filteredByYear.filter((document) => ROW_DOC_TYPES.has(document.doc_type));
    const source = scoped.length > 0 ? scoped : filteredByYear;

    return [...source].sort((left, right) => {
      const leftParsed = new Date(left.published_at).getTime();
      const rightParsed = new Date(right.published_at).getTime();
      const leftTs = Number.isFinite(leftParsed) ? leftParsed : 0;
      const rightTs = Number.isFinite(rightParsed) ? rightParsed : 0;
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
  const isChatExpanded = expandedChatBySymbol[effectiveSelectedSymbol] ?? false;
  const visibleMessages = useMemo(() => {
    if (isChatExpanded || activeSession.messages.length <= CHAT_RENDER_LIMIT) {
      return activeSession.messages;
    }
    return activeSession.messages.slice(-CHAT_RENDER_LIMIT);
  }, [activeSession.messages, isChatExpanded]);
  const hiddenMessageCount = Math.max(0, activeSession.messages.length - visibleMessages.length);

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

  const summaryDeckKey = summaryView ? toSummaryDeckKey(effectiveSelectedSymbol, summaryView.docId) : "";
  const activeSummaryDeck =
    summaryDeckKey.length > 0 ? summaryDecksByKey[summaryDeckKey] ?? createEmptyDeck() : createEmptyDeck();
  const currentSummaryCard = activeSummaryDeck.cards[activeSummaryDeck.currentIndex] ?? null;
  const summarySources = currentSummaryCard?.source_refs.length
    ? currentSummaryCard.source_refs
    : activeSummaryDeck.sources;

  const summaryDocument = useMemo(() => {
    if (!summaryView) {
      return null;
    }
    return documentRows.find((document) => document.id === summaryView.docId) ?? null;
  }, [documentRows, summaryView]);

  useEffect(() => {
    if (!summaryDeckKey || !activeSummaryDeck.cards.length || activeSummaryDeck.isLoading) {
      return;
    }
    persistDeck(summaryDeckKey, activeSummaryDeck);
  }, [activeSummaryDeck, summaryDeckKey]);

  async function submitMainQuestion(rawQuestion: string, options?: { docIds?: string[] }) {
    if (!effectiveSelectedSymbol || isAsking) {
      return;
    }

    const question = rawQuestion.trim();
    if (!question) {
      return;
    }

    const currentSession = sessionsBySymbol[effectiveSelectedSymbol] ?? createEmptySession();
    const conversationHistory = currentSession.messages.slice(-6).map((message) => ({
      role: message.role,
      content: message.content,
    }));

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
    setSummaryView({ docId: document.id });
    setDragStartX(null);
    setDragOffsetX(0);

    if (aiFlashcardsV1) {
      return;
    }

    if (!effectiveSelectedSymbol) {
      return;
    }

    const nextDeckKey = toSummaryDeckKey(effectiveSelectedSymbol, document.id);
    const existingDeck = summaryDecksByKey[nextDeckKey];
    if (existingDeck?.cards.length || existingDeck?.isLoading) {
      return;
    }

    const cachedDeck = loadDeckFromStorage(nextDeckKey);
    if (cachedDeck) {
      setSummaryDecksByKey((previous) => ({
        ...previous,
        [nextDeckKey]: cachedDeck,
      }));
      return;
    }

    setSummaryDecksByKey((previous) => ({
      ...previous,
      [nextDeckKey]: {
        ...createEmptyDeck(),
        isLoading: true,
      },
    }));

    try {
      const response = await fetchSummaryCardsInit({
        symbol: effectiveSelectedSymbol,
        company_name: selectedCompany?.company_name,
        year: selectedYear === "ALL" ? undefined : selectedYear,
        doc_ids: [document.id],
      });

      const cards = response.cards
        .map((card) => sanitizeSummaryCard(card))
        .filter((card) => card.title && card.explanation);

      setSummaryDecksByKey((previous) => ({
        ...previous,
        [nextDeckKey]: {
          cards,
          currentIndex: 0,
          isLoading: false,
          error: cards.length > 0 ? null : "No AI cards were generated for this document yet.",
          sources: response.sources,
        },
      }));
    } catch (error) {
      setSummaryDecksByKey((previous) => ({
        ...previous,
        [nextDeckKey]: {
          ...createEmptyDeck(),
          isLoading: false,
          error:
            error instanceof Error ? error.message : "Could not generate summary cards for this document right now.",
        },
      }));
    }
  }

  async function requestNextSummaryCard(swipeDirection: "left" | "right") {
    if (!effectiveSelectedSymbol || !summaryView || !summaryDeckKey || !currentSummaryCard) {
      return;
    }

    if (activeSummaryDeck.isLoading) {
      return;
    }

    setSummaryDecksByKey((previous) => {
      const existing = previous[summaryDeckKey] ?? createEmptyDeck();
      return {
        ...previous,
        [summaryDeckKey]: {
          ...existing,
          isLoading: true,
          error: null,
        },
      };
    });

    try {
      const response = await fetchSummaryCardsNext({
        symbol: effectiveSelectedSymbol,
        company_name: selectedCompany?.company_name,
        year: selectedYear === "ALL" ? undefined : selectedYear,
        doc_ids: [summaryView.docId],
        swipe_direction: swipeDirection,
        current_card: {
          concept: currentSummaryCard.concept,
          title: currentSummaryCard.title,
          level: currentSummaryCard.level,
        },
      });

      const incomingCards = response.cards
        .map((card) => sanitizeSummaryCard(card))
        .filter((card) => card.title && card.explanation);

      setSummaryDecksByKey((previous) => {
        const existing = previous[summaryDeckKey] ?? createEmptyDeck();
        let cards = mergeUniqueCards(existing.cards, incomingCards);
        if (cards.length === existing.cards.length && incomingCards[0]) {
          cards = [...existing.cards, { ...incomingCards[0], id: createMessageId() }];
        }

        const nextIndex = cards.length > 0 ? cards.length - 1 : 0;
        return {
          ...previous,
          [summaryDeckKey]: {
            cards,
            currentIndex: nextIndex,
            isLoading: false,
            error: cards.length > 0 ? null : "No follow-up card could be generated.",
            sources: response.sources.length > 0 ? response.sources : existing.sources,
          },
        };
      });
    } catch (error) {
      setSummaryDecksByKey((previous) => {
        const existing = previous[summaryDeckKey] ?? createEmptyDeck();
        return {
          ...previous,
          [summaryDeckKey]: {
            ...existing,
            isLoading: false,
            error: error instanceof Error ? error.message : "Could not generate the next card right now.",
          },
        };
      });
    }
  }

  function resetCardDrag() {
    setDragStartX(null);
    setDragOffsetX(0);
  }

  function applySwipeDelta(delta: number) {
    resetCardDrag();

    if (Math.abs(delta) < SWIPE_THRESHOLD) {
      return;
    }

    void requestNextSummaryCard(delta > 0 ? "right" : "left");
  }

  function animateAndRequestKnowledgeCard(direction: "left" | "right") {
    if (activeSummaryDeck.isLoading) {
      return;
    }
    setDragOffsetX(direction === "right" ? 18 : -18);
    window.setTimeout(() => {
      setDragOffsetX(0);
    }, 120);
    void requestNextSummaryCard(direction);
  }

  function handleSummaryCardPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    if (!currentSummaryCard || activeSummaryDeck.isLoading) {
      return;
    }

    setDragStartX(event.clientX);
    setDragOffsetX(0);
    if (event.pointerType !== "touch") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function handleSummaryCardPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragStartX === null) {
      return;
    }
    setDragOffsetX(event.clientX - dragStartX);
  }

  function handleSummaryCardPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragStartX === null) {
      return;
    }

    const delta = event.clientX - dragStartX;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    applySwipeDelta(delta);
  }

  return (
    <main className="h-[100dvh] bg-slate-100 px-2 py-2">
      <div className="mx-auto w-full max-w-[430px]">
        <Card className="flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_24px_70px_-28px_rgba(15,23,42,0.55)]">
          <header className="shrink-0 space-y-3 border-b border-slate-200 px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                <Sparkles className="size-4 text-emerald-600" />
                Groww AI
              </h1>
              <div className="flex items-center gap-1.5">
                <Badge className={isGuestMode ? "bg-amber-100 text-amber-800 hover:bg-amber-100" : "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"}>
                  {isGuestMode ? "Guest mode" : "Chat with filings"}
                </Badge>
                {onLogout ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    onClick={onLogout}
                  >
                    Exit
                  </Button>
                ) : null}
              </div>
            </div>

            <CompanySelector
              companies={selectableCompanies}
              selectedSymbol={selectedSymbol}
              selectedCompanyName={selectedCompany?.company_name}
              searchText={companySearchText}
              minSearchChars={2}
              onSearchTextChange={setCompanySearchText}
              onSelectSymbol={(symbol) => {
                setSelectedSymbol(symbol);
                const company = selectableCompanies.find((item) => item.symbol === symbol);
                if (company) {
                  setCompanySearchText(company.company_name);
                  setSelectedCompaniesBySymbol((previous) => ({
                    ...previous,
                    [company.symbol]: company,
                  }));
                }
              }}
              isLoading={companiesQuery.isLoading}
              error={companiesQuery.error}
            />

            {isGuestMode ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                Guest access: company search is limited to 3 companies. Register to unlock full universe.
              </p>
            ) : null}

            {selectedCompany ? (
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-700">Filings</p>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:text-slate-900"
                    onClick={() =>
                      setIsFilingsPanelOpenBySymbol((previous) => ({
                        ...previous,
                        [effectiveSelectedSymbol]: !isFilingsPanelOpen,
                      }))
                    }
                  >
                    {isFilingsPanelOpen ? (
                      <>
                        Collapse
                        <ChevronUp className="size-3.5" />
                      </>
                    ) : (
                      <>
                        Expand
                        <ChevronDown className="size-3.5" />
                      </>
                    )}
                  </button>
                </div>

                {isFilingsPanelOpen ? (
                  <>
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="space-y-1">
                        <Label htmlFor="fy-selection" className="text-[10px] uppercase tracking-wide text-slate-500">
                          FY
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
                          className="flex h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                        >
                          <option value="ALL">All</option>
                          {yearOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <Label
                          htmlFor="document-type-selection"
                          className="text-[10px] uppercase tracking-wide text-slate-500"
                        >
                          Document
                        </Label>
                        <select
                          id="document-type-selection"
                          value={selectedDocumentType}
                          onChange={(event) => {
                            const nextType = event.target.value as DocumentTypeFilter;
                            setSelectedDocTypeBySymbol((previous) => ({
                              ...previous,
                              [effectiveSelectedSymbol]: nextType,
                            }));
                            setSelectedDocIdBySymbol((previous) => ({
                              ...previous,
                              [effectiveSelectedSymbol]: "",
                            }));
                            setSummaryView(null);
                          }}
                          className="flex h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                        >
                          {FILINGS_DOC_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                      {documentsQuery.isLoading ? (
                        <p className="text-xs text-slate-500">Loading filings...</p>
                      ) : null}
                      {documentsQuery.error ? <p className="text-xs text-rose-600">{documentsQuery.error}</p> : null}

                      {!documentsQuery.isLoading && !documentsQuery.error && documentRows.length === 0 ? (
                        <div className="rounded-md border border-dashed border-slate-300 bg-white p-2 text-[11px] text-slate-500">
                          No filings for selected FY/type.
                        </div>
                      ) : null}

                      {documentRows.map((document) => {
                        const documentUrl = pickDocumentUrl(document);
                        const publishedLabel = formatPublishedAt(document.published_at);
                        const metadata = [
                          formatDocType(document.doc_type),
                          document.quarter || "",
                          document.fiscal_year || "",
                        ]
                          .filter((value) => value.length > 0)
                          .join(" • ");
                        const metadataLine = publishedLabel
                          ? `${metadata || "Filing"} | ${publishedLabel}`
                          : metadata || "Filing";
                        const isSelectedForChat = selectedChatDocument?.id === document.id;
                        const rowDeckKey = toSummaryDeckKey(effectiveSelectedSymbol, document.id);
                        const isRowSummaryLoading = Boolean(summaryDecksByKey[rowDeckKey]?.isLoading);

                        return (
                          <article
                            key={document.id}
                            className={`cursor-pointer rounded-md border px-2 py-2 ${
                              isSelectedForChat ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 bg-white"
                            }`}
                            onClick={() => {
                              setSelectedDocIdBySymbol((previous) => ({
                                ...previous,
                                [effectiveSelectedSymbol]:
                                  previous[effectiveSelectedSymbol] === document.id ? "" : document.id,
                              }));
                            }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="line-clamp-1 text-[11px] text-slate-600">{metadataLine}</p>
                              <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[9px]">
                                {document.exchange ?? "OTHER"}
                              </Badge>
                            </div>

                            <div className="mt-1.5 flex flex-wrap gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                className="h-6 px-1.5 text-[10px]"
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

                              {documentUrl ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-6 px-1.5 text-[10px]"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    window.open(documentUrl, "_blank", "noopener,noreferrer");
                                  }}
                                >
                                  Doc
                                </Button>
                              ) : null}

                              <Button
                                type="button"
                                variant="outline"
                                className="h-6 border-emerald-300 px-1.5 text-[10px] text-emerald-700 hover:bg-emerald-50"
                                disabled={isRowSummaryLoading}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedDocIdBySymbol((previous) => ({
                                    ...previous,
                                    [effectiveSelectedSymbol]: document.id,
                                  }));
                                  void openSummaryView(document);
                                }}
                              >
                                {isRowSummaryLoading ? "..." : "AI"}
                              </Button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="text-[11px] text-slate-500">Collapsed to keep chat visible. Tap Expand to open.</p>
                )}
              </div>
            ) : null}
          </header>

          <div className="flex min-h-0 flex-1 flex-col bg-slate-50/40">
            {!selectedCompany ? (
              <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-slate-500">
                Select a company to start chat and filing analysis.
              </div>
            ) : summaryView ? (
              <Suspense
                fallback={
                  <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-slate-500">
                    Loading summary view...
                  </div>
                }
              >
                {aiFlashcardsV1 ? (
                  <FlashcardsPanel
                    symbol={effectiveSelectedSymbol}
                    companyName={selectedCompany?.company_name}
                    document={summaryDocument}
                    selectedYear={selectedYear}
                    onBack={() => setSummaryView(null)}
                  />
                ) : (
                  <SummaryDeckView
                    summaryDocumentTitle={summaryDocument?.title}
                    activeSummaryDeck={activeSummaryDeck}
                    currentSummaryCard={currentSummaryCard}
                    summarySources={summarySources}
                    dragOffsetX={dragOffsetX}
                    dragStartX={dragStartX}
                    onBack={() => setSummaryView(null)}
                    onPointerDown={handleSummaryCardPointerDown}
                    onPointerMove={handleSummaryCardPointerMove}
                    onPointerEnd={handleSummaryCardPointerEnd}
                    onRequestLeft={() => {
                      animateAndRequestKnowledgeCard("left");
                    }}
                    onRequestRight={() => {
                      animateAndRequestKnowledgeCard("right");
                    }}
                  />
                )}
              </Suspense>
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
                    {hiddenMessageCount > 0 ? (
                      <button
                        type="button"
                        className="mx-auto block rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-600 hover:text-slate-900"
                        onClick={() =>
                          setExpandedChatBySymbol((previous) => ({
                            ...previous,
                            [effectiveSelectedSymbol]: true,
                          }))
                        }
                      >
                        Show {hiddenMessageCount} older message{hiddenMessageCount === 1 ? "" : "s"}
                      </button>
                    ) : null}

                    {visibleMessages.map((message) => (
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
                  <p className="mt-1.5 text-[10px] text-slate-500">
                    For research and learning only. Not investment advice.
                  </p>
                </form>
              </>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
