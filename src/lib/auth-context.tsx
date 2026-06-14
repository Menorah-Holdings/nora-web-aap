import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { setAccessToken, silentRefresh } from "./api";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: "user" | "creator" | "admin";
  subscriptionTier: "free" | "premium";
}

interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function decodeExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Stable ref for the proactive refresh timer
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable ref to current token for use in callbacks without stale closures
  const tokenRef = useRef<string | null>(null);

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  // Schedules a refresh 60 seconds before the token expires.
  // Min 5 seconds so we don't fire immediately on very short-lived tokens.
  function scheduleProactiveRefresh(token: string) {
    clearTimer();
    const exp = decodeExp(token);
    if (!exp) return;
    const delay = Math.max(exp * 1000 - Date.now() - 60_000, 5_000);
    timerRef.current = setTimeout(doProactiveRefresh, delay);
  }

  async function doProactiveRefresh() {
    const newToken = await silentRefresh();
    if (!newToken) {
      // Refresh token expired — force the user back to login
      applyLogout();
      return;
    }
    tokenRef.current = newToken;
    setTokenState(newToken);
    setAccessToken(newToken);
    scheduleProactiveRefresh(newToken);
  }

  function applySession(token: string, userData: AuthUser) {
    tokenRef.current = token;
    setTokenState(token);
    setAccessToken(token);
    setUser(userData);
    scheduleProactiveRefresh(token);
  }

  function applyLogout() {
    clearTimer();
    tokenRef.current = null;
    setTokenState(null);
    setAccessToken(null);
    setUser(null);
  }

  // On mount: silently attempt to restore an existing session from the
  // httpOnly cookie. If the cookie is missing or expired, nothing happens
  // and the user stays on the public pages.
  useEffect(() => {
    (async () => {
      try {
        const newToken = await silentRefresh();
        if (newToken) {
          tokenRef.current = newToken;
          setTokenState(newToken);
          setAccessToken(newToken);
          scheduleProactiveRefresh(newToken);
          // TODO: fetch user profile from /api/users/me once DB is wired
          // and call setUser() with the result
        }
      } finally {
        setIsLoading(false);
      }
    })();

    return () => clearTimer();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? "Login failed");
    applySession(data.data.accessToken, data.data.user);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const register = useCallback(
    async (email: string, password: string, fullName: string) => {
      const res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, fullName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Registration failed");
      applySession(data.data.accessToken, data.data.user);
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const logout = useCallback(async () => {
    try {
      await fetch(`${BASE_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: tokenRef.current
          ? { Authorization: `Bearer ${tokenRef.current}` }
          : {},
      });
    } catch {
      // Best-effort — clear client session regardless
    }
    applyLogout();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider
      value={{ user, accessToken, isLoading, login, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
