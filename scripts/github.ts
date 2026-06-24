// Shared GitHub REST API helpers.
// Centralizes auth + error handling so every caller behaves consistently.

const GITHUB_API_URL = "https://api.github.com";

export function getToken(): string {
  const token = Bun.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not set in environment");
  return token;
}

export function ghHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getToken()}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "spelling-bee-js",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * Thin wrapper around fetch for the GitHub REST API.
 * Accepts a path (e.g. "/user") or a full URL, attaches auth headers, and
 * throws a descriptive error on non-2xx responses. Returns parsed JSON, or
 * null for empty bodies (e.g. 204 No Content).
 */
export async function gh<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = path.startsWith("http") ? path : `${GITHUB_API_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...ghHeaders(), ...(init.headers as Record<string, string>) },
  });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    const resetTime = reset ? new Date(Number(reset) * 1000) : null;
    throw new Error(
      `GitHub API rate limit / forbidden (${res.status}) for ${path}` +
        (resetTime ? `. Try again after ${resetTime.toISOString()}` : "")
    );
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `GitHub API ${res.status} ${res.statusText} for ${path}: ${body.slice(
        0,
        300
      )}`
    );
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
