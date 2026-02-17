import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

let assignConfidenceFromCard: (card: unknown) => number;
let buildThemeCandidates: (transcript: string, options?: Record<string, unknown>) => Array<{ evidence: string[] }>;
let mergeNearDuplicateThemes: (themes: unknown[], threshold?: number) => unknown[];

beforeAll(async () => {
  ({
    assignConfidenceFromCard,
    buildThemeCandidates,
    mergeNearDuplicateThemes,
  } = await import("../pipeline.cjs"));
});

describe("flashcards theme pipeline", () => {
  it("deduplicates near-identical themes", () => {
    const sampleThemes = [
      {
        id: "theme-1",
        tag: "Strategy",
        title: "Marketing investment continues with CAC discipline",
        materiality: 9.1,
        speakers: ["CEO"],
        evidence: ["Management will keep spending while CAC remains healthy.", "Growth focus remains active."],
        text: "Management will keep spending while CAC remains healthy and LTV is intact.",
      },
      {
        id: "theme-2",
        tag: "Strategy",
        title: "CAC-disciplined marketing investment remains elevated",
        materiality: 8.7,
        speakers: ["CFO"],
        evidence: ["CAC and LTV are the spending guardrails.", "Near-term EBITDA is not the first target."],
        text: "CAC and LTV are guardrails and marketing spend will remain elevated in near term.",
      },
    ];

    const merged = mergeNearDuplicateThemes(sampleThemes, 0.22);
    expect(merged.length).toBe(1);
    expect(merged[0].evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("assigns higher confidence when numeric and management signals are present", () => {
    const high = assignConfidenceFromCard({
      summary: "Management stated EBITDA margin moved to 16.4 percent and revenue grew 18 percent.",
      implication: "This can support operating leverage if execution remains stable.",
      evidence: [
        "CFO stated EBITDA margin expanded by 120 bps to 16.4 percent.",
        "CEO said revenue growth was 18 percent year-on-year.",
      ],
    });
    const low = assignConfidenceFromCard({
      summary: "Team discussed several opportunities but gave limited specifics.",
      implication: "The outlook remains uncertain.",
      evidence: ["Discussion remained broad without clear quantified targets.", "No explicit timing commitment was shared."],
    });

    expect(high).toBeGreaterThan(low);
    expect(high).toBeGreaterThanOrEqual(0.82);
  });

  it("extracts multiple candidate themes from clean transcript fixture", () => {
    const fixturePath = path.resolve(__dirname, "../fixtures/cleanTranscript.txt");
    const transcript = fs.readFileSync(fixturePath, "utf8");
    const themes = buildThemeCandidates(transcript, {
      targetChars: 900,
      maxChars: 1500,
    });

    expect(themes.length).toBeGreaterThanOrEqual(2);
    expect(themes.every((theme: { evidence: string[] }) => theme.evidence.length >= 2)).toBe(true);
  });
});
