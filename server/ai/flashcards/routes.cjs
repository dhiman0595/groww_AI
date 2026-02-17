const { z } = require("zod");
const { parseFlashcardsRequest, parseFlashcardsResponse } = require("./contract.cjs");
const { createFlashcardsService } = require("./service.cjs");

const documentTextRequestSchema = z
  .object({
    source_url: z.string().trim().url(),
    fallback_text: z.string().trim().optional(),
  })
  .strict();

function isFeatureEnabled() {
  const flag = `${process.env.AI_FLASHCARDS_V1 || "true"}`.trim().toLowerCase();
  return flag !== "0" && flag !== "false" && flag !== "off";
}

function registerFlashcardsRoutes(app, options = {}) {
  const service = options.service || createFlashcardsService();
  const resolveDocumentText = options.resolveDocumentText;

  app.post("/api/ai/document-text", async (req, res) => {
    if (!isFeatureEnabled()) {
      res.status(404).json({ error: "AI Flashcards feature is disabled." });
      return;
    }

    if (typeof resolveDocumentText !== "function") {
      res.status(503).json({ error: "Document text resolver is unavailable." });
      return;
    }

    try {
      const payload = documentTextRequestSchema.parse(req.body || {});
      const resolvedText = await resolveDocumentText(payload.source_url);
      const text = `${resolvedText || payload.fallback_text || ""}`.trim();
      if (!text) {
        res.status(404).json({
          error: "Could not extract transcript text from the selected source.",
        });
        return;
      }

      res.json({
        document_text: text,
        char_count: text.length,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues[0]?.message || "Invalid payload." });
        return;
      }

      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to load document text.",
      });
    }
  });

  app.post("/api/ai/flashcards", async (req, res) => {
    if (!isFeatureEnabled()) {
      res.status(404).json({ error: "AI Flashcards feature is disabled." });
      return;
    }

    try {
      const parsedRequest = parseFlashcardsRequest(req.body || {});
      const response = await service.generateFlashcards(parsedRequest, {
        signal: req.signal,
      });
      const validated = parseFlashcardsResponse(response);
      res.set("Cache-Control", "no-store");
      res.json(validated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: error.issues.map((issue) => issue.message).join("; "),
        });
        return;
      }

      res.status(502).json({
        error: error instanceof Error ? error.message : "Failed to generate flashcards.",
      });
    }
  });
}

module.exports = {
  registerFlashcardsRoutes,
};
