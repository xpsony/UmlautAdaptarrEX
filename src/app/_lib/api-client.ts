"use client";

const CSRF_COOKIE = "ua-csrf";
const CSRF_HEADER = "x-csrf-token";

// Routes where a 401/CSRF response is expected and must not trigger a redirect
// (otherwise /login would redirect to /login).
const SESSION_FREE_PATHS = new Set(["/login", "/setup"]);
export const SESSION_EXPIRED_FLAG = "ua-session-expired";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function deriveMessage(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const obj = body as { message?: unknown; error?: unknown };
    if (typeof obj.message === "string" && obj.message.length > 0) return obj.message;
    if (typeof obj.error === "string" && obj.error.length > 0) return obj.error;
  }
  if (typeof body === "string" && body.length > 0) return body;
  return `HTTP ${status}`;
}

// True when the session is dead: cookie expired (401 unauthorized) or CSRF
// secret rotated by a server restart (403 csrf-invalid). Excludes domain-level
// 401/403 (e.g. invalid-credentials on the login form).
function isSessionLost(status: number, body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const code = (body as { error?: unknown }).error;
  if (status === 401 && code === "unauthorized") return true;
  if (status === 403 && code === "csrf-invalid") return true;
  return false;
}

let redirectInFlight = false;

function triggerAutoLogout(): void {
  if (typeof window === "undefined") return;
  if (redirectInFlight) return;
  const here = window.location.pathname;
  if (SESSION_FREE_PATHS.has(here)) return;
  redirectInFlight = true;
  try {
    sessionStorage.setItem(SESSION_EXPIRED_FLAG, "1");
  } catch {
    /* sessionStorage can throw in private tabs - non-fatal */
  }
  const next = encodeURIComponent(here + window.location.search);
  // Hard navigation on purpose: the session is dead, so a full reload must
  // drop all in-memory client state (react-query caches etc.) instead of a
  // soft router.push(). Absolute URL - relative destinations trip the
  // @next/next/no-location-assign-relative-destination rule.
  window.location.assign(new URL(`/login?next=${next}`, window.location.origin));
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (init.method && init.method.toUpperCase() !== "GET") {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers.set(CSRF_HEADER, csrf);
  }
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      try {
        body = await res.text();
      } catch {
        body = null;
      }
    }
    if (isSessionLost(res.status, body)) {
      triggerAutoLogout();
    }
    throw new ApiError(res.status, body, deriveMessage(res.status, body));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
