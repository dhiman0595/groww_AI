const { randomUUID } = require("node:crypto");
const { FLASHCARD_TAGS } = require("../../../shared/aiFlashcards.cjs");

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "from",
  "this",
  "have",
  "has",
  "were",
  "will",
  "shall",
  "their",
  "there",
  "about",
  "into",
  "very",
  "also",
  "what",
  "when",
  "where",
  "which",
  "while",
  "they",
  "been",
  "been",
  "being",
  "across",
  "could",
  "would",
  "should",
  "thanks",
  "thank",
  "operator",
]);

const MATERIALITY_KEYWORDS = {
  financialImpact: [
    "revenue",
    "ebitda",
    "margin",
    "cost",
    "cash",
    "debt",
    "profit",
    "loss",
    "guidance",
    "growth",
    "capex",
    "working capital",
  ],
  managementIntent: [
    "plan",
    "intend",
    "strategy",
    "focus",
    "priority",
    "invest",
    "expansion",
    "hiring",
    "launch",
    "partnership",
    "target",
  ],
  forwardLooking: [
    "next quarter",
    "coming quarter",
    "fy",
    "outlook",
    "expect",
    "pipeline",
    "roadmap",
    "medium term",
    "long term",
    "future",
  ],
  userProductImpact: [
    "customer",
    "user",
    "adoption",
    "engagement",
    "retention",
    "product",
    "platform",
    "sku",
    "service",
    "distribution",
  ],
  riskSignals: [
    "risk",
    "uncertain",
    "volatility",
    "pressure",
    "slowdown",
    "challenge",
    "headwind",
    "regulation",
    "compliance",
    "litigation",
  ],
};

function normalizeWhitespace(value) {
  return `${value || ""}`
    .replace(/\u00a0/g, " ")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeTranscriptText(value) {
  return normalizeWhitespace(`${value || ""}`)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function tokenize(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function buildTokenVector(value) {
  const vector = new Map();
  for (const token of tokenize(value)) {
    vector.set(token, (vector.get(token) || 0) + 1);
  }
  return vector;
}

function cosineSimilarity(left, right) {
  if (!left || !right || left.size === 0 || right.size === 0) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (const leftValue of left.values()) {
    leftNorm += leftValue * leftValue;
  }

  for (const rightValue of right.values()) {
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  for (const [token, leftValue] of left.entries()) {
    const rightValue = right.get(token);
    if (!rightValue) {
      continue;
    }
    dot += leftValue * rightValue;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function mergeVectors(target, source) {
  for (const [token, value] of source.entries()) {
    target.set(token, (target.get(token) || 0) + value);
  }
}

function splitSpeakerTurns(documentText) {
  const text = normalizeTranscriptText(documentText);
  if (!text) {
    return [];
  }

  const speakerRegex = /^([A-Za-z][A-Za-z0-9 .,&()/'-]{1,90}):\s*(.+)$/;
  const lines = text.split(/\n/);
  const turns = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(speakerRegex);
    if (match?.[1] && match?.[2]) {
      if (current && current.text.trim().length > 0) {
        turns.push({
          speaker: current.speaker,
          text: normalizeWhitespace(current.text),
        });
      }
      current = {
        speaker: normalizeWhitespace(match[1]),
        text: normalizeWhitespace(match[2]),
      };
      continue;
    }

    if (!current) {
      current = {
        speaker: "Unknown speaker",
        text: normalizeWhitespace(line),
      };
      continue;
    }

    current.text = normalizeWhitespace(`${current.text} ${line}`);
  }

  if (current && current.text.trim().length > 0) {
    turns.push({
      speaker: current.speaker,
      text: normalizeWhitespace(current.text),
    });
  }

  if (turns.length > 0) {
    return turns;
  }

  return text
    .split(/\n{2,}/)
    .map((part) => normalizeWhitespace(part))
    .filter((part) => part.length > 40)
    .map((part) => ({ speaker: "Unknown speaker", text: part }));
}

function chunkSpeakerTurns(turns, options = {}) {
  const targetChars = Math.max(600, Math.min(Number(options.targetChars) || 1200, 2200));
  const maxChars = Math.max(targetChars, Math.min(Number(options.maxChars) || 1700, 3000));
  const chunks = [];
  let current = null;

  function flushChunk() {
    if (!current) {
      return;
    }
    const normalizedText = normalizeWhitespace(current.text);
    if (normalizedText.length < 80) {
      current = null;
      return;
    }
    chunks.push({
      id: `chunk-${chunks.length + 1}`,
      text: normalizedText,
      speakers: Array.from(current.speakers),
      turnCount: current.turnCount,
    });
    current = null;
  }

  for (const turn of turns) {
    const turnText = normalizeWhitespace(turn.text);
    if (!turnText) {
      continue;
    }

    if (!current) {
      current = {
        text: turnText,
        speakers: new Set([turn.speaker || "Unknown speaker"]),
        turnCount: 1,
      };
      continue;
    }

    const nextLength = current.text.length + turnText.length + 1;
    if (nextLength > maxChars || (nextLength > targetChars && current.turnCount >= 3)) {
      flushChunk();
      current = {
        text: turnText,
        speakers: new Set([turn.speaker || "Unknown speaker"]),
        turnCount: 1,
      };
      continue;
    }

    current.text = `${current.text} ${turnText}`;
    current.turnCount += 1;
    current.speakers.add(turn.speaker || "Unknown speaker");
  }

  flushChunk();
  return chunks;
}

function detectThemeTag(text) {
  const lower = normalizeWhitespace(text).toLowerCase();
  if (!lower) {
    return "Operations";
  }

  const checks = [
    ["Financials", MATERIALITY_KEYWORDS.financialImpact],
    ["Guidance", MATERIALITY_KEYWORDS.forwardLooking],
    ["Product", ["product", "platform", "feature", "launch", "roadmap", "service", "technology"]],
    ["Risk", MATERIALITY_KEYWORDS.riskSignals],
    ["Regulation", ["sebi", "regulator", "regulation", "compliance", "policy", "legal"]],
    ["Strategy", MATERIALITY_KEYWORDS.managementIntent],
    ["Operations", ["supply", "execution", "capacity", "ops", "store", "distribution", "hiring"]],
  ];

  let best = "Operations";
  let bestScore = -1;
  for (const [tag, keywords] of checks) {
    let score = 0;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        score += 1;
      }
    }
    if (score > bestScore) {
      best = tag;
      bestScore = score;
    }
  }

  if (!FLASHCARD_TAGS.includes(best)) {
    return "Operations";
  }

  return best;
}

function scoreMateriality(text) {
  const normalized = normalizeWhitespace(text).toLowerCase();
  const numberMatches = normalized.match(/\b\d+(?:\.\d+)?%?\b/g) || [];
  const numericSignal = Math.min(numberMatches.length, 8) * 0.55;

  function keywordHits(keywords) {
    return keywords.reduce((total, keyword) => total + (normalized.includes(keyword) ? 1 : 0), 0);
  }

  const financialImpact = keywordHits(MATERIALITY_KEYWORDS.financialImpact) * 2.1;
  const managementIntent = keywordHits(MATERIALITY_KEYWORDS.managementIntent) * 1.8;
  const forwardLooking = keywordHits(MATERIALITY_KEYWORDS.forwardLooking) * 1.7;
  const userProductImpact = keywordHits(MATERIALITY_KEYWORDS.userProductImpact) * 1.4;
  const riskSignal = keywordHits(MATERIALITY_KEYWORDS.riskSignals) * 1.1;
  const verbosityBonus = Math.min(Math.max(normalized.length / 1200, 0), 1.6);

  return Number(
    (financialImpact + managementIntent + forwardLooking + userProductImpact + riskSignal + numericSignal + verbosityBonus).toFixed(3)
  );
}

function toSentences(text) {
  return normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 30);
}

function pickEvidenceBullets(text, target = 4) {
  const sentences = toSentences(text);
  const scored = sentences
    .map((sentence) => {
      const lower = sentence.toLowerCase();
      let score = 0;
      if (/\d/.test(lower)) {
        score += 2;
      }
      if (/(guidance|outlook|expect|target|margin|revenue|ebitda|cash|debt|risk|capex)/.test(lower)) {
        score += 2;
      }
      if (/(management|ceo|cfo|company|team|stated|said|noted|mentioned)/.test(lower)) {
        score += 1;
      }
      return { sentence, score };
    })
    .sort((left, right) => right.score - left.score);

  const bullets = [];
  const seen = new Set();
  for (const item of scored) {
    const normalized = item.sentence.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    bullets.push(item.sentence.slice(0, 280));
    if (bullets.length >= target) {
      break;
    }
  }

  return bullets;
}

function deriveThemeTitle(text, tag, maxLength = 90) {
  const firstSentence = toSentences(text)[0] || normalizeWhitespace(text).slice(0, maxLength);
  const cleaned = firstSentence.replace(/[^\w\s%.,:/()-]/g, "").trim();
  const preferred = cleaned.length > 8 ? cleaned : `${tag} update`;
  return preferred.length > maxLength ? `${preferred.slice(0, maxLength - 3).trim()}...` : preferred;
}

function buildThemeCandidates(documentText, options = {}) {
  const turns = splitSpeakerTurns(documentText);
  const chunks = chunkSpeakerTurns(turns, options);

  const clusters = [];
  for (const chunk of chunks) {
    const vector = buildTokenVector(chunk.text);
    let bestCluster = null;
    let bestSimilarity = 0;

    for (const cluster of clusters) {
      const similarity = cosineSimilarity(vector, cluster.vector);
      if (similarity > bestSimilarity) {
        bestCluster = cluster;
        bestSimilarity = similarity;
      }
    }

    if (bestCluster && bestSimilarity >= 0.29) {
      bestCluster.chunks.push(chunk);
      mergeVectors(bestCluster.vector, vector);
      for (const speaker of chunk.speakers) {
        bestCluster.speakers.add(speaker);
      }
      continue;
    }

    clusters.push({
      chunks: [chunk],
      vector,
      speakers: new Set(chunk.speakers),
    });
  }

  return clusters
    .map((cluster, index) => {
      const text = normalizeWhitespace(cluster.chunks.map((chunk) => chunk.text).join(" "));
      const tag = detectThemeTag(text);
      const materiality = scoreMateriality(text);
      const evidence = pickEvidenceBullets(text, 4);
      return {
        id: `theme-${index + 1}`,
        tag,
        title: deriveThemeTitle(text, tag),
        materiality,
        speakers: Array.from(cluster.speakers),
        evidence,
        text,
      };
    })
    .filter((theme) => theme.evidence.length >= 2)
    .sort((left, right) => right.materiality - left.materiality);
}

function jaccardSimilarity(left, right) {
  const leftSet = new Set(tokenize(left));
  const rightSet = new Set(tokenize(right));
  if (leftSet.size === 0 || rightSet.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }
  const union = leftSet.size + rightSet.size - intersection;
  if (union <= 0) {
    return 0;
  }
  return intersection / union;
}

function mergeNearDuplicateThemes(themes, threshold = 0.62) {
  const merged = [];

  for (const theme of themes) {
    let target = null;
    let bestScore = 0;

    for (const existing of merged) {
      const titleScore = jaccardSimilarity(theme.title, existing.title);
      const textScore = jaccardSimilarity(theme.text.slice(0, 900), existing.text.slice(0, 900));
      const score = titleScore * 0.55 + textScore * 0.45;
      if (score > bestScore) {
        bestScore = score;
        target = existing;
      }
    }

    if (target && bestScore >= threshold) {
      target.materiality = Math.max(target.materiality, theme.materiality);
      target.text = normalizeWhitespace(`${target.text} ${theme.text}`);
      target.evidence = Array.from(new Set([...target.evidence, ...theme.evidence])).slice(0, 6);
      target.speakers = Array.from(new Set([...target.speakers, ...theme.speakers]));
      target.tag = target.materiality >= theme.materiality ? target.tag : theme.tag;
      continue;
    }

    merged.push({
      ...theme,
      speakers: [...theme.speakers],
      evidence: [...theme.evidence],
    });
  }

  return merged.sort((left, right) => right.materiality - left.materiality);
}

function rankThemesByMateriality(themes, options = {}) {
  const minEvidence = Math.max(2, Math.min(Number(options.minEvidence) || 2, 5));
  return themes
    .filter((theme) => Array.isArray(theme.evidence) && theme.evidence.length >= minEvidence)
    .sort((left, right) => right.materiality - left.materiality);
}

function buildThemePromptContext(themes, options = {}) {
  const limit = Math.max(8, Math.min(Number(options.limit) || 14, 20));
  return themes.slice(0, limit).map((theme, index) => {
    const evidenceLines = theme.evidence.slice(0, 4).map((line) => `- ${line}`).join("\n");
    return [
      `[THEME ${index + 1}]`,
      `Title hint: ${theme.title}`,
      `Tag hint: ${theme.tag}`,
      `Materiality score: ${theme.materiality.toFixed(2)}`,
      `Speakers: ${theme.speakers.join(", ") || "Unknown"}`,
      "Evidence candidates:",
      evidenceLines,
      "",
      `Context snippet: ${theme.text.slice(0, 1300)}`,
    ].join("\n");
  });
}

function clampConfidence(value) {
  if (!Number.isFinite(value)) {
    return 0.7;
  }
  return Math.max(0, Math.min(1, Number(value)));
}

function assignConfidenceFromCard(card) {
  const summary = normalizeWhitespace(card?.summary || "");
  const implication = normalizeWhitespace(card?.implication || "");
  const evidence = Array.isArray(card?.evidence) ? card.evidence.join(" ") : "";
  const combined = `${summary} ${implication} ${evidence}`.toLowerCase();

  const numericSignals = (combined.match(/\b\d+(?:\.\d+)?%?\b/g) || []).length;
  const managementSignal = /(management|ceo|cfo|stated|said|noted|guided|expects)/.test(combined);
  const qualitativeSignal = /(focus|strategy|expansion|operational|risk|outlook|demand|margin|cost)/.test(combined);

  if (numericSignals >= 2 && managementSignal) {
    return 0.9;
  }

  if (numericSignals >= 1 && qualitativeSignal) {
    return 0.82;
  }

  if (qualitativeSignal) {
    return 0.72;
  }

  if (combined.length > 120) {
    return 0.64;
  }

  return 0.58;
}

function formatFallbackSummary(theme) {
  const first = theme.evidence[0] || theme.title;
  const second = theme.evidence[1] || "";
  return normalizeWhitespace(`${first} ${second}`).slice(0, 450);
}

function formatFallbackImplication(theme) {
  const directional = /(risk|pressure|slowdown|uncertain)/i.test(theme.text)
    ? "This increases execution risk and should be tracked through upcoming quarters."
    : "This can influence forward business momentum and should be monitored with next-quarter disclosures.";
  return directional;
}

function createFallbackCardsFromThemes(options) {
  const themes = Array.isArray(options.themes) ? options.themes : [];
  const maxCards = Math.max(8, Math.min(Number(options.maxCards) || 12, 14));

  return themes.slice(0, maxCards).map((theme) => {
    const summary = formatFallbackSummary(theme);
    const implication = formatFallbackImplication(theme);
    const confidence = assignConfidenceFromCard({
      summary,
      implication,
      evidence: theme.evidence,
    });
    return {
      id: randomUUID(),
      title: deriveThemeTitle(theme.title || summary, theme.tag),
      tag: detectThemeTag(`${theme.tag} ${theme.text}`),
      summary,
      evidence: theme.evidence.slice(0, 4),
      implication,
      confidence: clampConfidence(confidence),
    };
  });
}

module.exports = {
  assignConfidenceFromCard,
  buildThemeCandidates,
  buildThemePromptContext,
  chunkSpeakerTurns,
  clampConfidence,
  createFallbackCardsFromThemes,
  detectThemeTag,
  mergeNearDuplicateThemes,
  normalizeTranscriptText,
  rankThemesByMateriality,
  scoreMateriality,
  splitSpeakerTurns,
};
