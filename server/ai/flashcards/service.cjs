const { createHash, randomUUID } = require("node:crypto");
const { FLASHCARD_TAGS, FLASHCARD_DOC_TYPE } = require("../../../shared/aiFlashcards.cjs");
const {
  flashcardsResponseSchema,
  parseFlashcardsResponse,
} = require("./contract.cjs");
const {
  assignConfidenceFromCard,
  buildThemeCandidates,
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
const MAX_DEFAULT_CARDS = 12;

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
  const size = Math.max(1, Number(maxChars) || 1);
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

function normalizeSourceRef(value) {
  const normalized = `${value || ""}`.trim().toLowerCase().replace(/\s+/g, "");
  const directMatch = normalized.match(/^p\d{1,4}$/);
  if (directMatch) {
    return directMatch[0];
  }
  const pageMatch = normalized.match(/^page(\d{1,4})$/);
  if (pageMatch?.[1]) {
    return `p${pageMatch[1]}`;
  }
  return "";
}

function detectEvidenceType(value) {
  const text = `${value || ""}`;
  return /\b\d+(?:\.\d+)?%?\b|₹|\bcr\b|\bcrore\b|\bbps\b|\bmn\b|\bmillion\b|\bbn\b|\bbillion\b/i.test(text)
    ? "metric"
    : "quote";
}

function parseExplicitPageChunks(documentText) {
  const text = normalizeTranscriptText(documentText);
  if (!text) {
    return [];
  }
  const regex = /(?:^|\n)\s*(?:\[)?p(\d{1,4})(?:\])?\s*[:\-]\s*/gim;
  const matches = Array.from(text.matchAll(regex));
  if (matches.length === 0) {
    return [];
  }

  const chunks = [];
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const page = Number(current?.[1]);
    if (!Number.isFinite(page) || page <= 0) {
      continue;
    }
    const start = (current.index || 0) + current[0].length;
    const end = next ? next.index || text.length : text.length;
    const chunkText = normalizeWhitespace(text.slice(start, end));
    if (!chunkText) {
      continue;
    }
    chunks.push({
      page,
      source_ref: `p${page}`,
      text: chunkText,
    });
  }

  return chunks;
}

function buildPseudoPageChunks(documentText, options = {}) {
  const text = normalizeTranscriptText(documentText);
  if (!text) {
    return [];
  }

  const targetChars = Math.max(900, Math.min(Number(options.targetChars) || 1700, 2600));
  const maxPages = Math.max(6, Math.min(Number(options.maxPages) || 50, 120));
  const paragraphs = text
    .split(/\n{2,}/)
    .map((part) => normalizeWhitespace(part))
    .filter((part) => part.length > 0);
  const units = paragraphs.length > 0 ? paragraphs : text.split(/\n/).map((part) => normalizeWhitespace(part)).filter(Boolean);

  const pages = [];
  let current = "";

  for (const unit of units) {
    const next = current ? `${current}\n${unit}` : unit;
    if (next.length > targetChars && current) {
      const page = pages.length + 1;
      pages.push({
        page,
        source_ref: `p${page}`,
        text: current,
      });
      current = unit;
      if (pages.length >= maxPages) {
        break;
      }
      continue;
    }
    current = next;
  }

  if (current && pages.length < maxPages) {
    const page = pages.length + 1;
    pages.push({
      page,
      source_ref: `p${page}`,
      text: current,
    });
  }

  return pages.map((page) => ({
    ...page,
    text: normalizeWhitespace(page.text),
  }));
}

function buildPageChunks(documentText) {
  const explicit = parseExplicitPageChunks(documentText);
  if (explicit.length > 0) {
    return explicit;
  }
  return buildPseudoPageChunks(documentText);
}

function buildTranscriptContextWithPageMarkers(pageChunks, maxChars) {
  const budget = Math.max(6_000, Number(maxChars) || 6_000);
  if (!Array.isArray(pageChunks) || pageChunks.length === 0) {
    return "";
  }

  const output = [];
  let length = 0;
  for (const page of pageChunks) {
    const line = `${page.source_ref}: ${page.text}`;
    const nextLength = length + line.length + 2;
    if (nextLength > budget) {
      break;
    }
    output.push(line);
    length = nextLength;
  }

  return output.join("\n\n");
}

function inferSourceRefForEvidence(evidenceText, pageChunks, sourceRefHint) {
  const hint = normalizeSourceRef(sourceRefHint);
  if (hint) {
    return hint;
  }

  const embeddedMatch = sanitizeCardText(evidenceText).toLowerCase().match(/\bp(\d{1,4})\b/);
  if (embeddedMatch?.[1]) {
    return `p${embeddedMatch[1]}`;
  }

  const pages = Array.isArray(pageChunks) ? pageChunks : [];
  if (pages.length === 0) {
    return "p1";
  }

  const tokens = tokenizeForGrounding(evidenceText);
  if (tokens.length < 2) {
    return pages[0].source_ref || "p1";
  }

  let bestRef = pages[0].source_ref || "p1";
  let bestScore = -1;

  for (const page of pages) {
    const haystack = `${page.text || ""}`.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestRef = page.source_ref || bestRef;
    }
  }

  return bestRef;
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

function normalizeEvidenceEntry(rawEvidence, pageChunks, documentText, fallbackRef) {
  if (!rawEvidence) {
    return null;
  }

  const isObjectInput = typeof rawEvidence === "object" && !Array.isArray(rawEvidence);
  const text = truncateText(
    sanitizeCardText(isObjectInput ? rawEvidence.text || rawEvidence.claim || "" : rawEvidence),
    320
  );
  if (text.length < 8) {
    return null;
  }
  if (!isEvidenceGrounded(text, documentText)) {
    return null;
  }

  const type = isObjectInput && (rawEvidence.type === "metric" || rawEvidence.type === "quote")
    ? rawEvidence.type
    : detectEvidenceType(text);
  const sourceRef = inferSourceRefForEvidence(
    text,
    pageChunks,
    isObjectInput ? rawEvidence.source_ref || rawEvidence.sourceRef || fallbackRef : fallbackRef
  );

  return {
    type,
    text,
    source_ref: sourceRef || "p1",
  };
}

function normalizeCardWithTheme(rawCard, theme, documentText, pageChunks) {
  const title = truncateText(sanitizeCardText(rawCard?.title || theme?.title || "Theme update"), 90);
  const summary = truncateText(sanitizeCardText(rawCard?.summary || rawCard?.explanation || theme?.text || ""), 850);
  const whyItMatters = truncateText(
    sanitizeCardText(
      rawCard?.why_it_matters || rawCard?.implication || "This should be tracked in future disclosures."
    ),
    420
  );

  const rawEvidence = Array.isArray(rawCard?.evidence)
    ? rawCard.evidence
    : [];
  const fallbackEvidence = Array.isArray(theme?.evidence)
    ? theme.evidence
    : [];
  const fallbackRef = Array.isArray(theme?.pageRefs) && theme.pageRefs.length > 0 ? theme.pageRefs[0] : "p1";
  const combinedEvidence = [...rawEvidence, ...fallbackEvidence]
    .map((item) => normalizeEvidenceEntry(item, pageChunks, documentText, fallbackRef))
    .filter((item) => Boolean(item));

  const dedupedEvidence = [];
  const seen = new Set();
  for (const item of combinedEvidence) {
    const key = `${item.type}|${item.source_ref}|${item.text.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    dedupedEvidence.push(item);
    if (dedupedEvidence.length >= 6) {
      break;
    }
  }
  const evidence = dedupedEvidence.slice(0, 6);
  if (evidence.length < 2) {
    return null;
  }

  const confidenceInput = Number(rawCard?.confidence);
  const computedConfidence = assignConfidenceFromCard({
    summary,
    why_it_matters: whyItMatters,
    evidence,
  });
  const confidence = clampConfidence(Number.isFinite(confidenceInput) ? confidenceInput : computedConfidence);

  return {
    id: randomUUID(),
    title,
    tag: normalizeTag(rawCard?.tag, `${summary} ${theme?.text || ""}`),
    summary,
    evidence,
    why_it_matters: whyItMatters,
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
  const targetMax = Math.max(MIN_DEFAULT_CARDS, Math.min(Number(maxCards) || 12, MAX_DEFAULT_CARDS));
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
    "[SYSTEM]",
    "You are a senior equity-research assistant. Your job is to generate high-signal, evidence-backed flashcards from earnings-call/concall transcripts.",
    "",
    "You must be:",
    "- Fact-first",
    "- Concise",
    "- Non-repetitive",
    "- Explicit about uncertainty",
    "",
    "Never invent numbers, timelines, management guidance, or product details.",
    "If a claim is not clearly supported in the transcript context, do not include it.",
  ].join("\n");

  const developerPrompt = [
    "[DEVELOPER]",
    "Return STRICT JSON ONLY. No markdown. No prose before/after JSON.",
    "",
    "Output schema (must match exactly):",
    "{",
    '  "meta": {',
    '    "company": "string",',
    '    "period": "string",',
    '    "doc_type": "concall_transcript",',
    '    "generated_at": "ISO-8601 string"',
    "  },",
    '  "cards": [',
    "    {",
    '      "id": "string",',
    '      "title": "string (<= 90 chars)",',
    '      "tag": "Financials|Product|Strategy|Operations|Risk|Regulation|Guidance",',
    '      "summary": "2-4 sentences, factual",',
    '      "evidence": [',
    "        {",
    '          "type": "metric|quote",',
    '          "text": "string",',
    '          "source_ref": "p<number>"',
    "        },",
    "        {",
    '          "type": "metric|quote",',
    '          "text": "string",',
    '          "source_ref": "p<number>"',
    "        }",
    "      ],",
    '      "why_it_matters": "1-2 sentences, specific and non-generic",',
    '      "confidence": 0.0',
    "    }",
    "  ]",
    "}",
    "",
    "Hard rules:",
    "1) Generate 8 to 12 cards total.",
    "2) Each card must have at least 2 evidence items.",
    "3) Every evidence item must include: exact claim text and source_ref in format p3, p14, etc.",
    "4) Use only transcript-grounded facts in summary/evidence.",
    "5) why_it_matters may include interpretation, but must be directly supported by evidence.",
    "6) No duplicate themes. Merge overlaps and avoid repeated metrics without new context.",
    "7) Confidence calibration:",
    "   - 0.90-0.98: explicit metric + clear management statement",
    "   - 0.78-0.89: explicit qualitative statement, moderate specificity",
    "   - 0.65-0.77: inference from multiple supported facts",
    "   - <0.65: include only if highly material and clearly uncertain",
    "8) Do not output placeholders like N/A, unknown, or empty strings.",
    "9) Ensure tag diversity:",
    "   - at least 3 Financials cards",
    "   - at least 2 cards across Product/Strategy",
    "   - at least 1 card from Risk/Regulation/Guidance",
    "10) Keep language analyst-grade: precise, neutral, non-promotional, no investment advice.",
    `Target card count for this run: ${Math.max(MIN_DEFAULT_CARDS, Math.min(Number(payload.maxCards) || 12, MAX_DEFAULT_CARDS))}.`,
    "",
    "Quality bar:",
    "- Card title should state one clear thesis.",
    "- summary should describe what happened.",
    "- why_it_matters should explain why this is important now.",
    "- evidence should be audit-friendly.",
    "",
    "- Return valid minified JSON only. No markdown, no prose.",
  ].join("\n");

  const userPrompt = [
    "[USER]",
    `Company: ${payload.metadata.company}`,
    `Period: ${payload.metadata.period}`,
    "Document type: Concall Transcript",
    "Transcript context with page markers:",
    payload.transcriptWithPageMarkers,
    payload.externalSummaryText ? `External summary text:\n${payload.externalSummaryText}` : "",
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
      "[SYSTEM]",
      "You are a JSON repair assistant for financial flashcards.",
      "Repair only format/schema issues while preserving original grounded claims.",
      "Return valid minified JSON only. No markdown, no prose.",
    ].join("\n"),
    userPrompt: [
      "[DEVELOPER]",
      "Repair this output to match the exact schema and rules below.",
      "",
      "Schema reminder:",
      '{"meta":{"company":"string","period":"string","doc_type":"concall_transcript","generated_at":"ISO-8601 string"},"cards":[{"id":"string","title":"string (<= 90 chars)","tag":"Financials|Product|Strategy|Operations|Risk|Regulation|Guidance","summary":"2-4 sentences, factual","evidence":[{"type":"metric|quote","text":"string","source_ref":"p<number>"},{"type":"metric|quote","text":"string","source_ref":"p<number>"}],"why_it_matters":"1-2 sentences, specific and non-generic","confidence":0.0}]}',
      `Hard constraints: cards must be ${MIN_DEFAULT_CARDS}-${MAX_DEFAULT_CARDS}; every card needs >=2 evidence objects with source_ref p<number>.`,
      "",
      "[USER]",
      "Validation error:",
      options.errorMessage,
      "",
      "Previous model output:",
      options.rawOutput,
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
      evidence: [line, `Management commentary: ${line}`],
      pageRefs: [`p${index + 1}`],
      text: line,
    }));

  return fallbackText;
}

function buildTranscriptDigest(pageChunks) {
  return buildTranscriptContextWithPageMarkers(pageChunks, FLASHCARDS_MAX_CONTEXT_CHARS);
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
    const maxCards = Math.max(MIN_DEFAULT_CARDS, Math.min(Number(input.maxCards) || 12, MAX_DEFAULT_CARDS));
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
      const pageChunks = buildPageChunks(documentText);
      const themes = deriveThemeSet(documentText, maxCards);
      const transcriptWithPageMarkers = buildTranscriptDigest(pageChunks);
      const { systemPrompt, userPrompt } = buildPromptSections({
        metadata,
        maxCards,
        externalSummaryText,
        transcriptWithPageMarkers,
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
          .map((candidate, index) =>
            normalizeCardWithTheme(candidate, themes[index % themes.length], documentText, pageChunks)
          )
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
