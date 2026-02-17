import express from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

let registerFlashcardsRoutes: (app: express.Express, options?: Record<string, unknown>) => void;
let createFlashcardsService: (options?: Record<string, unknown>) => { generateFlashcards: (input: unknown) => Promise<unknown> };
let parseFlashcardsResponse: (payload: unknown) => unknown;

beforeAll(async () => {
  ({ registerFlashcardsRoutes } = await import("../routes.cjs"));
  ({ createFlashcardsService } = await import("../service.cjs"));
  ({ parseFlashcardsResponse } = await import("../contract.cjs"));
});

describe("flashcards API integration", () => {
  it("returns schema-valid JSON from /api/ai/flashcards", async () => {
    const app = express();
    app.use(express.json());

    registerFlashcardsRoutes(app, {
      resolveDocumentText: async () => "sample document text",
      service: {
        generateFlashcards: async () => ({
          meta: {
            company: "Sample Co",
            period: "Q2 FY2026",
            doc_type: "concall_transcript",
            generated_at: new Date().toISOString(),
          },
          cards: Array.from({ length: 8 }, (_, index) => ({
            id: crypto.randomUUID(),
            title: `Theme ${index + 1} update`,
            tag: index < 3 ? "Financials" : index < 5 ? "Strategy" : "Risk",
            summary: "Management discussed growth discipline and execution priorities for the quarter.",
            evidence: [
              {
                type: "quote",
                text: "Management linked growth investment to CAC/LTV discipline.",
                source_ref: `p${index + 1}`,
              },
              {
                type: "quote",
                text: "Commentary indicated profitability remains secondary to expansion in near term.",
                source_ref: `p${index + 2}`,
              },
            ],
            why_it_matters: "Execution consistency will determine whether growth remains quality-led.",
            confidence: 0.8,
          })),
        }),
      },
    });

    const response = await request(app).post("/api/ai/flashcards").send({
      documentText:
        "CEO: Revenue grew with better conversion quality. CFO: Margin expanded due to lower fulfillment costs and disciplined spend.",
      metadata: {
        company: "Sample Co",
        period: "Q2 FY2026",
      },
      maxCards: 8,
    });

    expect(response.status).toBe(200);
    expect(() => parseFlashcardsResponse(response.body)).not.toThrow();
    expect(response.body.cards.length).toBeGreaterThanOrEqual(8);
  });

  it("retries once when first Gemini JSON is malformed", async () => {
    const geminiCaller = vi
      .fn()
      .mockResolvedValueOnce({
        text: "this is not valid json output",
        usage: {},
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          meta: {
            company: "Groww",
            period: "Q2 FY26",
            doc_type: "concall_transcript",
            generated_at: new Date().toISOString(),
          },
          cards: [
            ...Array.from({ length: 8 }, (_, index) => ({
              id: crypto.randomUUID(),
              title: `Revenue growth stayed broad-based ${index + 1}`,
              tag: index < 3 ? "Financials" : index < 5 ? "Product" : "Guidance",
              summary:
                "Management reported growth across major lines with controlled operating costs. Commentary emphasized execution discipline over headline expansion alone.",
              evidence: [
                {
                  type: "metric",
                  text: "Revenue growth was described as broad-based across key offerings.",
                  source_ref: `p${index + 1}`,
                },
                {
                  type: "quote",
                  text: "Management linked margin outcomes to fulfillment and marketing efficiency.",
                  source_ref: `p${index + 2}`,
                },
              ],
              why_it_matters: "Sustaining quality growth depends on balancing scale and cost discipline.",
              confidence: 0.84,
            })),
          ],
        }),
        usage: {},
      });

    const service = createFlashcardsService({
      geminiCaller,
      model: "gemini-2.5-flash",
    });

    const output = await service.generateFlashcards({
      documentText:
        "CEO: Revenue grew 18 percent year-on-year. CFO: EBITDA margin expanded by 120 bps and net cash improved.",
      metadata: {
        company: "Groww",
        period: "Q2 FY26",
      },
      maxCards: 8,
    });

    expect(geminiCaller).toHaveBeenCalledTimes(2);
    expect(() => parseFlashcardsResponse(output)).not.toThrow();
    expect(output.cards.length).toBeGreaterThanOrEqual(8);
  });
});
