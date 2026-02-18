import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CompanyDocument } from "@/features/documents/types";
import { FlashcardsPanel } from "@/features/flashcards/components/FlashcardsPanel";
import * as flashcardsClient from "@/features/flashcards/api/flashcardsClient";

vi.mock("@/features/flashcards/api/flashcardsClient", () => ({
  fetchDocumentTextFromSource: vi.fn(),
  generateAiFlashcards: vi.fn(),
  toShareableFlashcardText: vi.fn(() => "share text"),
}));

vi.mock("@/features/flashcards/analytics", () => ({
  trackFlashcardsEvent: vi.fn(),
}));

const fetchDocumentTextFromSource = vi.mocked(flashcardsClient.fetchDocumentTextFromSource);
const generateAiFlashcards = vi.mocked(flashcardsClient.generateAiFlashcards);

const baseDocument: CompanyDocument = {
  id: "doc-1",
  company_name: "Groww Ltd",
  symbol: "GROWW",
  exchange: "NSE",
  doc_type: "CONCALL_TRANSCRIPT",
  title: "Q2 FY26 Concall Transcript",
  description: "Concall discussion text",
  quarter: "Q2",
  fiscal_year: "FY2026",
  published_at: "2026-01-20T10:00:00.000Z",
  source_name: "NSE filings",
  source_url: "https://example.com/transcript.pdf",
  file_url: "https://example.com/transcript.pdf",
};

describe("FlashcardsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders generated flashcards list", async () => {
    vi.mocked(fetchDocumentTextFromSource).mockResolvedValue(
      "CEO: Revenue grew. CFO: EBITDA margin expanded and costs were managed."
    );
    vi.mocked(generateAiFlashcards).mockResolvedValue({
      meta: {
        company: "Groww Ltd",
        period: "Q2 FY2026",
        doc_type: "concall_transcript",
        generated_at: new Date().toISOString(),
      },
      cards: [
        {
          id: "ac56d3fd-2a7d-4c0d-ac87-fe0a48846d6e",
          title: "Revenue growth remained broad-based",
          tag: "Financials",
          summary: "Management highlighted growth across major lines with controlled costs.",
          evidence: [
            {
              type: "quote",
              text: "CEO said revenue growth remained broad-based for the quarter.",
              source_ref: "p2",
            },
            {
              type: "quote",
              text: "CFO linked margin progress to operating efficiency.",
              source_ref: "p3",
            },
          ],
          why_it_matters: "Execution quality is critical to preserve growth with margin discipline.",
          confidence: 0.88,
        },
        {
          id: "23337865-ce44-4f2c-846d-6ece0124cfeb",
          title: "Expansion strategy remains selective",
          tag: "Strategy",
          summary: "Management indicated expansion will continue but with selective market prioritization.",
          evidence: [
            {
              type: "quote",
              text: "Leadership said expansion follows CAC and payback filters.",
              source_ref: "p4",
            },
            {
              type: "quote",
              text: "Commentary stressed quality cohorts over tactical discounting.",
              source_ref: "p5",
            },
          ],
          why_it_matters: "Growth can continue without fully sacrificing unit economics.",
          confidence: 0.89,
        },
      ],
    });

    render(
      <FlashcardsPanel
        symbol="GROWW"
        companyName="Groww Ltd"
        document={baseDocument}
        selectedYear="FY2026"
        onBack={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate Flashcards" }));

    expect(await screen.findByText("Revenue growth remained broad-based")).toBeInTheDocument();
    expect(screen.getByText("Expansion strategy remains selective")).toBeInTheDocument();
  });

  it("supports filtering by tag and sorting by confidence", async () => {
    vi.mocked(fetchDocumentTextFromSource).mockResolvedValue(
      "CEO: Revenue growth remained stable with disciplined costs. CFO: Margin outlook remains constructive with selective spend."
    );
    vi.mocked(generateAiFlashcards).mockResolvedValue({
      meta: {
        company: "Groww Ltd",
        period: "Q2 FY2026",
        doc_type: "concall_transcript",
        generated_at: new Date().toISOString(),
      },
      cards: [
        {
          id: "6dcf1093-25fc-4f49-8d0a-44587f3c77ec",
          title: "Risk commentary became more explicit",
          tag: "Risk",
          summary: "Management flagged near-term volatility in acquisition efficiency.",
          evidence: [
            {
              type: "quote",
              text: "CFO warned about short-term CAC volatility in specific cohorts.",
              source_ref: "p6",
            },
            {
              type: "quote",
              text: "Leadership said margin can fluctuate due to competitive campaigns.",
              source_ref: "p7",
            },
          ],
          why_it_matters: "Quarterly earnings quality can vary while acquisition dynamics normalize.",
          confidence: 0.87,
        },
        {
          id: "762cc03d-fc31-46e5-a9ef-f783f4df33d6",
          title: "Financial discipline supported margin",
          tag: "Financials",
          summary: "Cost execution and revenue mix supported better contribution outcomes.",
          evidence: [
            {
              type: "quote",
              text: "CFO noted margin expansion from cost optimization.",
              source_ref: "p8",
            },
            {
              type: "quote",
              text: "Management connected operating leverage with stable demand pockets.",
              source_ref: "p9",
            },
          ],
          why_it_matters: "Disciplined execution can protect margin even during growth investment cycles.",
          confidence: 0.9,
        },
      ],
    });

    render(
      <FlashcardsPanel
        symbol="GROWW"
        companyName="Groww Ltd"
        document={baseDocument}
        selectedYear="FY2026"
        onBack={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate Flashcards" }));
    await screen.findByText("Risk commentary became more explicit");

    fireEvent.change(screen.getByLabelText("Filter tag"), {
      target: { value: "Risk" },
    });
    expect(screen.getByText("Risk commentary became more explicit")).toBeInTheDocument();
    expect(screen.queryByText("Financial discipline supported margin")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter tag"), {
      target: { value: "ALL" },
    });
    fireEvent.change(screen.getByLabelText("Sort"), {
      target: { value: "confidence" },
    });

    await waitFor(() => {
      const titles = screen
        .getAllByRole("heading", { level: 3 })
        .map((node) => node.textContent?.trim())
        .filter((value): value is string => Boolean(value));
      expect(titles[0]).toBe("Financial discipline supported margin");
    });
  });

  it("shows API error state", async () => {
    vi.mocked(fetchDocumentTextFromSource).mockRejectedValue(new Error("LLM timeout"));

    render(
      <FlashcardsPanel
        symbol="GROWW"
        companyName="Groww Ltd"
        document={baseDocument}
        selectedYear="FY2026"
        onBack={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate Flashcards" }));
    expect(await screen.findByText("LLM timeout")).toBeInTheDocument();
  });
});
