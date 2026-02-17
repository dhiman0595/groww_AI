const { createHash, randomUUID } = require("node:crypto");
const { FLASHCARD_TAGS, FLASHCARD_DOC_TYPE } = require("../../../shared/aiFlashcards.cjs");
const {
  flashcardsResponseSchema,
  parseFlashcardsResponse,
} = require("./contract.cjs");
const {
  assignConfidenceFromCard,
  buildThemeCandidates,
  buildThemePromptContext,
  clampConfidence,
  createFallbackCardsFromThemes,
  detectThemeTag,
  mergeNearDuplicateThemes,
  normalizeTranscriptText,
  rankThemesByMateriality,
} = require("./pipeline.cjs");
const { FlashcardsTtlCache } = require("./cache.cjs");

const GEMINI_API_KEY = `${process.env.GEMINI_API_KEY || ""}`.trim();
const GEMINI_MODEL = `${process.env.GEMINI_MODEL || "gemini-2.5-flash"}`.trim();
const FLASHCARDS_MAX_CONTEXT_CHARS = Math.max(
  20_000,
  Math.min(Number(process.env.FLASHCARDS_MAX_CONTEXT_CHARS || 80_000), 220_000)
);
const FLASHCARDS_CACHE_TTL_MS = Math.max(
  3_600_000,
  Math.min(Number(process.env.FLASHCARDS_CACHE_TTL_MS || 86_400_000), 604_800_000)
);
const FLASHCARDS_CACHE_MAX_ENTRIES = Math.max(
  32,
  Math.min(Number(process.env.FLASHCARDS_CACHE_MAX_ENTRIES || 500), 5000)
);
const MIN_DEFAULT_CARDS = 8;

const sharedCache = new FlashcardsTtlCache({
  ttlMs: FLASHCARDS_CACHE_TTL_MS,
  maxEntries: FLASHCARDS_CACHE_MAX_ENTRIES,
});
const inFlight = new Map();

function normalizeWhitespace(value) {
  return `${value || ""}`
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hashText(value) {
  return createHash("sha256").update(`${value || ""}`).digest("hex");
}

function truncateText(value, maxChars) {
  const text = normalizeWhitespace(value);
  const size = Math.max(400, Number(maxChars) || 400);
  if (text.length <= size) {
    return text;
  }
  return `${text.slice(0, size - 3).trim()}...`;
}

function sanitizeCardText(value) {
  return normalizeWhitespace(
    `${value || ""}`
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`/g, "")
      .replace(/\*\*/g, "")
      .replace(/^\s*[-*]\s+/gm, "")
  );
}

function parseLlmOutput(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) {
      continue;
    }
    const text = parts
      .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
      .filter((value) => value.length > 0)
      .join("\n")
      .trim();
    if (text.length > 0) {
      return text;
    }
  }

  return null;
}

function tryParseJson(value) {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // continue
    }
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function extractGeminiUsage(data) {
  const usage = data?.usageMetadata;
  if (!usage || typeof usage !== "object") {
    return {
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
    };
  }
  return {
    prompt_tokens: Number.isFinite(usage.promptTokenCount) ? Number(usage.promptTokenCount) : null,
    completion_tokens: Number.isFinite(usage.candidatesTokenCount) ? Number(usage.candidatesTokenCount) : null,
    total_tokens: Number.isFinite(usage.totalTokenCount) ? Number(usage.totalTokenCount) : null,
  };
}

function logTelemetry(event, payload = {}) {
  console.info(
    `[flashcards_telemetry] ${JSON.stringify({
      event,
      at: new Date().toISOString(),
      ...payload,
    })}`
  );
}

async function callGeminiJson(options) {
  if (!GEMINI_API_KEY) {
    throw new Error("Gemini API key is not configured.");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const payload = {
    systemInstruction: {
      parts: [{ text: options.systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: options.userPrompt }],
      },
    ],
    generationConfig: {
      temperature: Number.isFinite(options.temperature) ? options.temperature : 0.2,
      responseMimeType: "application/json",
    },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini request failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = parseLlmOutput(data);
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  return {
    text,
    usage: extractGeminiUsage(data),
  };
}

function buildMetadata(inputMetadata = {}) {
  const company = sanitizeCardText(inputMetadata.company || "Unknown company").slice(0, 140) || "Unknown company";
  const period = sanitizeCardText(inputMetadata.period || inputMetadata.date || "Latest period").slice(0, 120) || "Latest period";
  return {
    company,
    period,
    doc_type: FLASHCARD_DOC_TYPE,
    generated_at: new Date().toISOString(),
  };
}

function tokenizeForGrounding(value) {
  return sanitizeCardText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function isEvidenceGrounded(evidenceBullet, documentText) {
  const bulletTokens = tokenizeForGrounding(evidenceBullet);
  if (bulletTokens.length < 3) {
    return false;
  }
  const haystack = normalizeWhitespace(documentText).toLowerCase();
  let hits = 0;
  for (const token of bulletTokens) {
    if (haystack.includes(token)) {
      hits += 1;
    }
  }
  return hits >= Math.min(4, bulletTokens.length);
}

function toCardCandidateList(parsed) {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.cards)) {
    return parsed.cards;
  }
  return [];
}

function normalizeTag(tag, fallbackText) {
  const normalized = sanitizeCardText(tag);
  if (FLASHCARD_TAGS.includes(normalized)) {
    return normalized;
  }
  return detectThemeTag(fallbackText);
}

function normalizeCardWithTheme(rawCard, theme, documentText) {
  const title = truncateText(sanitizeCardText(rawCard?.title || theme?.title || "Theme update"), 90);
  const summary = truncateText(sanitizeCardText(rawCard?.summary || rawCard?.explanation || theme?.text || ""), 850);
  const implication = truncateText(
    sanitizeCardText(rawCard?.implication || rawCard?.why_it_matters || "This should be tracked in future disclosures."),
    420
  );

  const rawEvidence = Array.isArray(rawCard?.evidence)
    ? rawCard.evidence.map((line) => truncateText(sanitizeCardText(line), 320)).filter((line) => line.length > 8)
    : [];
  const fallbackEvidence = Array.isArray(theme?.evidence)
    ? theme.evidence.map((line) => truncateText(sanitizeCardText(line), 320)).filter((line) => line.length > 8)
    : [];
  const combinedEvidence = Array.from(new Set([...rawEvidence, ...fallbackEvidence]))
    .filter((line) => isEvidenceGrounded(line, documentText))
    .slice(0, 4);

  const evidence = combinedEvidence.length >= 2 ? combinedEvidence : fallbackEvidence.slice(0, 2);
  if (evidence.length < 2) {
    return null;
  }

  const confidenceInput = Number(rawCard?.confidence);
  const computedConfidence = assignConfidenceFromCard({
    summary,
    implication,
    evidence,
  });
  const confidence = clampConfidence(Number.isFinite(confidenceInput) ? confidenceInput : computedConfidence);

  return {
    id: randomUUID(),
    title,
    tag: normalizeTag(rawCard?.tag, `${summary} ${theme?.text || ""}`),
    summary,
    evidence,
    implication,
    confidence,
  };
}

function dedupeCards(cards) {
  const deduped = [];
  const seen = new Set();
  for (const card of cards) {
    const key = `${card.title.toLowerCase()}|${card.tag}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(card);
  }
  return deduped;
}

function alignCardCount(cards, themes, maxCards) {
  const targetMax = Math.max(MIN_DEFAULT_CARDS, Math.min(Number(maxCards) || 12, 14));
  let output = dedupeCards(cards).slice(0, targetMax);

  if (output.length < MIN_DEFAULT_CARDS) {
    const usedTitles = new Set(output.map((card) => card.title.toLowerCase()));
    const fallback = createFallbackCardsFromThemes({
      themes,
      maxCards: targetMax,
    }).filter((card) => !usedTitles.has(card.title.toLowerCase()));
    output = [...output, ...fallback].slice(0, targetMax);
  }

  if (output.length === 0) {
    output = createFallbackCardsFromThemes({
      themes,
      maxCards: targetMax,
    });
  }

  if (output.length > 0 && output.length < MIN_DEFAULT_CARDS) {
    const templates = [...output];
    let index = 0;
    while (output.length < MIN_DEFAULT_CARDS) {
      const template = templates[index % templates.length];
      const angleNumber = output.length + 1;
      const variantTitle = truncateText(`${template.title} (angle ${angleNumber})`, 90);
      output.push({
        ...template,
        id: randomUUID(),
        title: variantTitle,
        confidence: clampConfidence(Math.max(0.65, template.confidence - 0.03)),
      });
      index += 1;
    }
  }

  return output.slice(0, targetMax);
}

function buildPromptSections(payload) {
  const systemPrompt = [
    "System role: You are an expert financial-document synthesizer for earnings call transcripts.",
    "Output must be factual, concise, and strictly grounded in provided transcript evidence.",
    "Never invent numbers, timelines, guidance, or management claims.",
    "Facts belong in summary/evidence; inference belongs only in implication.",
    "No investment advice language.",
  ].join("\n");

  const developerPrompt = [
    "Developer rules:",
    "- Return valid minified JSON only. No markdown, no prose.",
    "- Strict schema:",
    '{"meta":{"company":"string","period":"string","doc_type":"concall_transcript","generated_at":"ISO8601"},"cards":[{"id":"uuid","title":"<=90 chars","tag":"Strategy|Financials|Product|Risk|Regulation|Operations|Guidance","summary":"2-4 sentences","evidence":["bullet 1","bullet 2"],"implication":"1-2 sentences","confidence":0.0}]}',
    `- Generate ${MIN_DEFAULT_CARDS} to ${payload.maxCards} cards.`,
    "- Each card must include at least 2 evidence bullets grounded in transcript text.",
    "- Reject weak themes that have insufficient evidence.",
    "- Merge near-duplicate themes.",
    "- Confidence scoring guidance: 0.85-1 explicit management + numeric support; 0.65-0.84 clear qualitative; <0.65 only if materially important.",
    "- Keep tone factual and concise.",
  ].join("\n");

  const userPrompt = [
    "User payload:",
    JSON.stringify(
      {
        metadata: payload.metadata,
        maxCards: payload.maxCards,
      },
      null,
      0
    ),
    "",
    "Pre-clustered thematic context (materiality-ranked):",
    payload.themePromptLines.join("\n\n"),
    "",
    payload.externalSummaryText ? `External summary text:\n${payload.externalSummaryText}` : "",
    "",
    "Transcript digest (chunked window):",
    payload.transcriptDigest,
    "",
    "Return valid minified JSON only. No markdown, no prose.",
  ]
    .filter((part) => `${part}`.trim().length > 0)
    .join("\n");

  return {
    systemPrompt: `${systemPrompt}\n\n${developerPrompt}`,
    userPrompt,
  };
}

function buildRepairPrompt(options) {
  return {
    systemPrompt: [
      "You are a JSON repair assistant.",
      "Repair the previous model output so it matches the exact required schema.",
      "Return valid minified JSON only. No markdown, no prose.",
    ].join("\n"),
    userPrompt: [
      "Validation error:",
      options.errorMessage,
      "",
      "Previous model output:",
      options.rawOutput,
      "",
      "Schema reminder:",
      '{"meta":{"company":"string","period":"string","doc_type":"concall_transcript","generated_at":"ISO8601"},"cards":[{"id":"uuid","title":"<=90 chars","tag":"Strategy|Financials|Product|Risk|Regulation|Operations|Guidance","summary":"2-4 sentences","evidence":["bullet 1","bullet 2"],"implication":"1-2 sentences","confidence":0.0}]}',
      `Cards required: ${MIN_DEFAULT_CARDS}-${options.maxCards}.`,
      "Return valid minified JSON only. No markdown, no prose.",
    ].join("\n"),
  };
}

function deriveThemeSet(documentText, maxCards) {
  const initialThemes = buildThemeCandidates(documentText, {
    targetChars: 1200,
    maxChars: 1800,
  });
  const mergedThemes = mergeNearDuplicateThemes(initialThemes, 0.62);
  const rankedThemes = rankThemesByMateriality(mergedThemes);

  if (rankedThemes.length > 0) {
    return rankedThemes;
  }

  const fallbackText = normalizeTranscriptText(documentText)
    .split(/\n/)
    .filter((line) => line.length > 40)
    .slice(0, maxCards + 4)
    .map((line, index) => ({
      id: `fallback-theme-${index + 1}`,
      tag: detectThemeTag(line),
      title: truncateText(line, 90),
      materiality: 1 + index * 0.01,
      speakers: ["Unknown speaker"],
      evidence: [line, line],
      text: line,
    }));

  return fallbackText;
}

function buildTranscriptDigest(themes, documentText, maxCards) {
  const lines = buildThemePromptContext(themes, {
    limit: Math.max(maxCards + 2, 12),
  });
  const compact = lines.join("\n\n---\n\n");
  if (compact.length >= FLASHCARDS_MAX_CONTEXT_CHARS * 0.55) {
    return compact.slice(0, Math.floor(FLASHCARDS_MAX_CONTEXT_CHARS * 0.55));
  }

  const transcript = normalizeTranscriptText(documentText);
  const remaining = Math.max(1_500, FLASHCARDS_MAX_CONTEXT_CHARS - compact.length - 120);
  const tailChars = Math.floor(remaining * 0.35);
  const headChars = remaining - tailChars;
  const head = transcript.slice(0, headChars);
  const tail = transcript.length > tailChars ? transcript.slice(-tailChars) : "";
  const stitched = [compact, "Transcript window (head + tail):", head, tail].filter(Boolean).join("\n\n");
  return stitched.slice(0, FLASHCARDS_MAX_CONTEXT_CHARS);
}

async function defaultGeminiCaller(options) {
  return callGeminiJson(options);
}

function createFlashcardsService(options = {}) {
  const geminiCaller = options.geminiCaller || defaultGeminiCaller;
  const cache = options.cache || sharedCache;
  const model = options.model || GEMINI_MODEL;

  async function generateFlashcards(input, requestOptions = {}) {
    const startedAt = Date.now();
    const maxCards = Math.max(MIN_DEFAULT_CARDS, Math.min(Number(input.maxCards) || 12, 14));
    const metadata = buildMetadata(input.metadata);
    const documentText = normalizeTranscriptText(input.documentText);
    const externalSummaryText = truncateText(sanitizeCardText(input.externalSummaryText || ""), 12_000);

    const hashSeed = [
      hashText(documentText),
      hashText(externalSummaryText),
      metadata.company,
      metadata.period,
      model,
      maxCards,
    ].join("|");
    const cacheKey = hashText(hashSeed);

    const cached = cache.get(cacheKey);
    if (cached) {
      logTelemetry("flashcards_generate_success", {
        cached: true,
        latency_ms: Date.now() - startedAt,
        model,
        card_count: cached.cards.length,
      });
      return cached;
    }

    if (inFlight.has(cacheKey)) {
      return inFlight.get(cacheKey);
    }

    const pending = (async () => {
      const themes = deriveThemeSet(documentText, maxCards);
      const themePromptLines = buildThemePromptContext(themes, {
        limit: Math.max(maxCards + 2, 12),
      });
      const transcriptDigest = buildTranscriptDigest(themes, documentText, maxCards);
      const { systemPrompt, userPrompt } = buildPromptSections({
        metadata,
        maxCards,
        externalSummaryText,
        themePromptLines,
        transcriptDigest,
      });

      let rawModelText = "";
      let usage = {
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
      };
      let repairAttempted = false;

      async function parseModelResponse(modelOutput) {
        const parsed = tryParseJson(modelOutput);
        if (!parsed) {
          throw new Error("Model output was not valid JSON.");
        }
        const cardCandidates = toCardCandidateList(parsed);
        if (cardCandidates.length === 0) {
          throw new Error("Model output did not include cards.");
        }
        const normalizedCards = cardCandidates
          .map((candidate, index) => normalizeCardWithTheme(candidate, themes[index % themes.length], documentText))
          .filter((card) => Boolean(card));
        if (normalizedCards.length === 0) {
          throw new Error("Model cards were not valid after grounding checks.");
        }
        const alignedCards = alignCardCount(normalizedCards, themes, maxCards);
        const response = {
          meta: {
            company: metadata.company,
            period: metadata.period,
            doc_type: FLASHCARD_DOC_TYPE,
            generated_at: new Date().toISOString(),
          },
          cards: alignedCards,
        };
        return parseFlashcardsResponse(response);
      }

      try {
        const primary = await geminiCaller({
          systemPrompt,
          userPrompt,
          temperature: 0.2,
          signal: requestOptions.signal,
        });
        rawModelText = primary.text;
        usage = primary.usage || usage;

        let validated = null;
        try {
          validated = await parseModelResponse(rawModelText);
        } catch (error) {
          repairAttempted = true;
          const repairPrompt = buildRepairPrompt({
            errorMessage: error instanceof Error ? error.message : "Invalid schema.",
            rawOutput: rawModelText,
            maxCards,
          });
          const repaired = await geminiCaller({
            systemPrompt: repairPrompt.systemPrompt,
            userPrompt: repairPrompt.userPrompt,
            temperature: 0.05,
            signal: requestOptions.signal,
          });
          rawModelText = repaired.text;
          usage = {
            prompt_tokens:
              (usage.prompt_tokens || 0) + (repaired.usage?.prompt_tokens || 0) || null,
            completion_tokens:
              (usage.completion_tokens || 0) + (repaired.usage?.completion_tokens || 0) || null,
            total_tokens: (usage.total_tokens || 0) + (repaired.usage?.total_tokens || 0) || null,
          };
          validated = await parseModelResponse(rawModelText);
        }

        flashcardsResponseSchema.parse(validated);
        cache.set(cacheKey, validated);
        logTelemetry("flashcards_generate_success", {
          cached: false,
          latency_ms: Date.now() - startedAt,
          model,
          card_count: validated.cards.length,
          repair_attempted: repairAttempted,
          ...usage,
        });
        return validated;
      } catch (error) {
        const fallbackCards = alignCardCount([], themes, maxCards);
        const fallback = parseFlashcardsResponse({
          meta: {
            company: metadata.company,
            period: metadata.period,
            doc_type: FLASHCARD_DOC_TYPE,
            generated_at: new Date().toISOString(),
          },
          cards: fallbackCards,
        });
        cache.set(cacheKey, fallback);

        logTelemetry("flashcards_generate_error", {
          cached: false,
          latency_ms: Date.now() - startedAt,
          model,
          repair_attempted: repairAttempted,
          error: error instanceof Error ? error.message.slice(0, 220) : "Unknown error",
          ...usage,
        });
        return fallback;
      }
    })();

    inFlight.set(cacheKey, pending);
    try {
      return await pending;
    } finally {
      inFlight.delete(cacheKey);
    }
  }

  return {
    generateFlashcards,
  };
}

module.exports = {
  createFlashcardsService,
  extractGeminiUsage,
  tryParseJson,
};
