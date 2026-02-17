function toBooleanFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (typeof value !== "string") {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }
  if (normalized === "1" || normalized === "true" || normalized === "on") {
    return true;
  }
  return defaultValue;
}

export const aiFlashcardsV1 = toBooleanFlag(import.meta.env.VITE_AI_FLASHCARDS_V1, true);
