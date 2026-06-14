const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

// Held in module scope so the fetch wrapper always reads the latest token
// without needing React state or context.
let _token: string | null = null;

// Shared promise to prevent concurrent refresh races — if two 401s fire at the same time, only one actual refresh request goes out. 
let _inflightRefresh: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  _token = token;
}

export async function silentRefresh(): Promise<string | null> {
  if (_inflightRefresh) return _inflightRefresh;

  _inflightRefresh = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) return null;
      const data = await res.json();
      const newToken: string | null = data.data?.accessToken ?? null;
      _token = newToken;
      return newToken;
    } catch {
      return null;
    } finally {
      _inflightRefresh = null;
    }
  })();

  return _inflightRefresh;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (_token) headers.set("Authorization", `Bearer ${_token}`);

  let res = await fetch(`${BASE_URL}${path}`, { ...init, headers, credentials: "include" });

  
  if (res.status === 401) {
    const newToken = await silentRefresh();
    if (newToken) {
      headers.set("Authorization", `Bearer ${newToken}`);
      res = await fetch(`${BASE_URL}${path}`, { ...init, headers, credentials: "include" });
    }
  }

  return res;
}
