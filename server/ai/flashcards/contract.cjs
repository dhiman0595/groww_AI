const { z } = require("zod");
const { FLASHCARD_TAGS, FLASHCARD_DOC_TYPE } = require("../../../shared/aiFlashcards.cjs");

const CARD_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isoDateString = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "Expected ISO8601 timestamp.");

const flashcardTagSchema = z.enum(FLASHCARD_TAGS);

const flashcardEvidenceSchema = z.array(z.string().trim().min(8).max(320)).min(2).max(6);

const flashcardSchema = z
  .object({
    id: z.string().trim().regex(CARD_ID_REGEX, "Card id must be a UUID."),
    title: z.string().trim().min(6).max(90),
    tag: flashcardTagSchema,
    summary: z.string().trim().min(24).max(850),
    evidence: flashcardEvidenceSchema,
    implication: z.string().trim().min(12).max(420),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const flashcardsResponseSchema = z
  .object({
    meta: z
      .object({
        company: z.string().trim().min(1).max(140),
        period: z.string().trim().min(1).max(120),
        doc_type: z.literal(FLASHCARD_DOC_TYPE),
        generated_at: isoDateString,
      })
      .strict(),
    cards: z.array(flashcardSchema).min(1).max(20),
  })
  .strict();

const flashcardsRequestSchema = z
  .object({
    documentText: z.string().trim().min(40),
    metadata: z
      .object({
        company: z.string().trim().max(140).optional(),
        period: z.string().trim().max(120).optional(),
        date: z.string().trim().max(80).optional(),
        source_url: z.string().trim().url().max(1200).optional(),
      })
      .strict()
      .optional(),
    externalSummaryText: z.string().trim().max(20000).optional(),
    maxCards: z.number().int().min(8).max(14).default(12),
  })
  .strict();

function parseFlashcardsRequest(payload) {
  return flashcardsRequestSchema.parse(payload);
}

function parseFlashcardsResponse(payload) {
  return flashcardsResponseSchema.parse(payload);
}

module.exports = {
  CARD_ID_REGEX,
  flashcardSchema,
  flashcardsRequestSchema,
  flashcardsResponseSchema,
  parseFlashcardsRequest,
  parseFlashcardsResponse,
};
