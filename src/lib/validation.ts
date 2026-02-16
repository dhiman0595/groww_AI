import type { UrlValidationResult } from "@/types/assistant";

export function validateDeploymentUrl(value: string): UrlValidationResult {
  const trimmed = value.trim();

  if (!trimmed) {
    return { isValid: false, error: "Please add a deployment URL." };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { isValid: false, error: "URL must begin with http:// or https://." };
    }
    return { isValid: true };
  } catch {
    return { isValid: false, error: "That URL format looks invalid. Try a full absolute URL." };
  }
}
