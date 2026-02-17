const { z } = require("zod");
const { FLASHCARD_TAGS, FLASHCARD_DOC_TYPE } = require("../../../shared/aiFlashcards.cjs");

const isoDateString = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "Expected ISO8601 timestamp.");

const flashcardTagSchema = z.enum(FLASHCARD_TAGS);

const sourceRefSchema = z
  .string()
  .trim()
  .regex(/^p\d{1,4}$/i, "source_ref must be in format p<number>.");

const flashcardEvidenceItemSchema = z
  .object({
    type: z.enum(["metric", "quote"]),
    text: z.string().trim().min(8).max(320),
    source_ref: sourceRefSchema,
  })
  .strict();

const flashcardEvidenceSchema = z.array(flashcardEvidenceItemSchema).min(2).max(6);

const flashcardSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    title: z.string().trim().min(6).max(90),
    tag: flashcardTagSchema,
    summary: z.string().trim().min(24).max(850),
    evidence: flashcardEvidenceSchema,
    why_it_matters: z.string().trim().min(12).max(420),
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
    cards: z.array(flashcardSchema).min(8).max(12),
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
    maxCards: z.number().int().min(8).max(12).default(12),
  })
  .strict();

function parseFlashcardsRequest(payload) {
  return flashcardsRequestSchema.parse(payload);
}

function parseFlashcardsResponse(payload) {
  return flashcardsResponseSchema.parse(payload);
}

module.exports = {
  flashcardSchema,
  flashcardEvidenceItemSchema,
  flashcardsRequestSchema,
  flashcardsResponseSchema,
  parseFlashcardsRequest,
  parseFlashcardsResponse,
};
