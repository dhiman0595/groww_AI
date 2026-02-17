export type OtpChannel = "mobile" | "email";

interface RequestOtpPayload {
  channel: OtpChannel;
  identifier: string;
}

export interface RequestOtpResponse {
  ok: boolean;
  channel: OtpChannel;
  masked_identifier: string;
  expires_in_sec: number;
  delivery_mode: string;
  message: string;
  demo_otp?: string;
}

interface VerifyOtpPayload {
  channel: OtpChannel;
  identifier: string;
  otp: string;
}

export interface VerifyOtpResponse {
  ok: boolean;
  token: string;
  user: {
    channel: OtpChannel;
    identifier: string;
    masked_identifier: string;
  };
  verified_at: string;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").trim();

function withBaseUrl(pathname: string): string {
  if (!API_BASE_URL) {
    return pathname;
  }
  return `${API_BASE_URL.replace(/\/$/, "")}${pathname}`;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload?.error) {
      return payload.error;
    }
  } catch {
    // Uses fallback for non-json errors.
  }
  return fallback;
}

export async function requestOtp(payload: RequestOtpPayload): Promise<RequestOtpResponse> {
  const response = await fetch(withBaseUrl("/api/auth/request-otp"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await readApiError(response, "Could not send OTP right now.");
    throw new Error(message);
  }

  return (await response.json()) as RequestOtpResponse;
}

export async function verifyOtp(payload: VerifyOtpPayload): Promise<VerifyOtpResponse> {
  const response = await fetch(withBaseUrl("/api/auth/verify-otp"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await readApiError(response, "Could not verify OTP right now.");
    throw new Error(message);
  }

  return (await response.json()) as VerifyOtpResponse;
}
