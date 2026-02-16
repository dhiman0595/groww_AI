export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatSource {
  title: string;
  url?: string;
  source_name?: string;
}

export interface ChatRequest {
  symbol: string;
  company_name?: string;
  question: string;
  year?: string;
  doc_ids?: string[];
  quarter?: string;
  management_focus?: string;
  filings_focus?: string;
  history?: ChatTurn[];
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
  follow_up_questions: string[];
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").trim();

function withBaseUrl(pathname: string): string {
  if (!API_BASE_URL) {
    return pathname;
  }

  return `${API_BASE_URL.replace(/\/$/, "")}${pathname}`;
}

export async function fetchChatAnswer(payload: ChatRequest): Promise<ChatResponse> {
  const endpoint = withBaseUrl("/api/chat");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = "Failed to fetch chat answer from API.";

    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) {
        message = payload.error;
      }
    } catch {
      // Uses default message when API response body is unavailable.
    }

    if (response.status === 404 && !API_BASE_URL) {
      message =
        "Chat API not found on this domain. Ensure /api/chat is deployed and reachable from the same app URL.";
    }

    if (response.status >= 500 && !API_BASE_URL) {
      message =
        `Backend is unavailable (status ${response.status}). Check server logs and environment variables (GEMINI_API_KEY, DATABASE_URL).`;
    }

    if (message === "Failed to fetch chat answer from API.") {
      message = `Chat request failed with status ${response.status}.`;
    }

    throw new Error(message);
  }

  const parsed = (await response.json()) as Partial<ChatResponse>;

  return {
    answer: typeof parsed.answer === "string" ? parsed.answer : "No answer returned.",
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    follow_up_questions: Array.isArray(parsed.follow_up_questions) ? parsed.follow_up_questions : [],
  };
}
