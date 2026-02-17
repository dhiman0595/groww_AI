import { useMemo, useState } from "react";
import { AuthGate, type UserSession } from "@/pages/AuthGate";
import { IndexPage } from "@/pages/Index";

const AUTH_SESSION_STORAGE_KEY = "groww-ai-auth-session-v2";
const AUTH_SESSION_VERSION = 2;

function loadSessionFromStorage(): UserSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<UserSession> & { version?: number };
    if (!parsed || (parsed.accessMode !== "guest" && parsed.accessMode !== "registered")) {
      return null;
    }
    if (Number(parsed.version) !== AUTH_SESSION_VERSION) {
      return null;
    }

    return {
      accessMode: parsed.accessMode,
      channel: parsed.channel,
      identifier: parsed.identifier,
      maskedIdentifier: parsed.maskedIdentifier,
      token: parsed.token,
      authenticatedAt: parsed.authenticatedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function App() {
  const [session, setSession] = useState<UserSession | null>(() => loadSessionFromStorage());

  const sessionKey = useMemo(() => `${session?.accessMode || "anonymous"}-${session?.token || "none"}`, [session]);

  function handleAuthenticated(nextSession: UserSession) {
    setSession(nextSession);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        AUTH_SESSION_STORAGE_KEY,
        JSON.stringify({
          ...nextSession,
          version: AUTH_SESSION_VERSION,
        })
      );
    }
  }

  function handleLogout() {
    setSession(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    }
  }

  if (!session) {
    return <AuthGate onAuthenticated={handleAuthenticated} />;
  }

  return <IndexPage key={sessionKey} accessMode={session.accessMode} onLogout={handleLogout} />;
}

export default App;
