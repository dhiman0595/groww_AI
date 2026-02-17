import type {
  AiFlashcard,
  AiFlashcardsRequest,
  AiFlashcardsRequestMetadata,
  AiFlashcardsResponse,
  FlashcardTag,
} from "../../../shared/aiFlashcards";

export type {
  AiFlashcard,
  AiFlashcardsRequest,
  AiFlashcardsRequestMetadata,
  AiFlashcardsResponse,
  FlashcardTag,
};

export type FlashcardsLoadingStage = "idle" | "reading" | "identifying" | "building";

export type FlashcardsSortMode = "materiality" | "confidence";
