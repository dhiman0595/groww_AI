import { beforeAll, describe, expect, it } from "vitest";

let parseFlashcardsResponse: (payload: unknown) => unknown;

beforeAll(async () => {
  ({ parseFlashcardsResponse } = await import("../contract.cjs"));
});

describe("flashcards schema validation", () => {
  it("accepts a valid flashcards payload", () => {
    const payload = {
      meta: {
        company: "Groww",
        period: "Q2 FY2026",
        doc_type: "concall_transcript",
        generated_at: new Date().toISOString(),
      },
      cards: [
        {
          id: "32f9e34e-3f74-4f8b-8bc4-0392786a3643",
          title: "Marketing spend tied to CAC discipline",
          tag: "Strategy",
          summary:
            "Management said marketing will stay elevated while CAC remains healthy. They framed spend as growth investment rather than a short-term profitability move.",
          evidence: [
            "Management stated they will continue investing if CAC and LTV remain healthy.",
            "Commentary linked recent user additions to incremental marketing intensity.",
          ],
          implication: "Near-term margin can fluctuate while growth investments remain active.",
          confidence: 0.86,
        },
      ],
    };

    const parsed = parseFlashcardsResponse(payload);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.meta.doc_type).toBe("concall_transcript");
  });

  it("rejects cards with missing evidence bullets", () => {
    const invalidPayload = {
      meta: {
        company: "Groww",
        period: "Q2 FY2026",
        doc_type: "concall_transcript",
        generated_at: new Date().toISOString(),
      },
      cards: [
        {
          id: "32f9e34e-3f74-4f8b-8bc4-0392786a3643",
          title: "Invalid",
          tag: "Risk",
          summary: "Summary text with no enough evidence bullets for this card.",
          evidence: ["Only one evidence bullet"],
          implication: "Implication line",
          confidence: 0.6,
        },
      ],
    };

    expect(() => parseFlashcardsResponse(invalidPayload)).toThrowError();
  });
});
