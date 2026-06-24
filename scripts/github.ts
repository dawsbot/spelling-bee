// Shared GitHub REST API helpers.
// Centralizes auth + error handling so every caller behaves consistently.
//
// Auth precedence: the `gh` CLI token is preferred, with GITHUB_TOKEN as an
// optional fallback. An empty/absent GITHUB_TOKEN is fully supported as long
// as you're logged in via `gh auth login`.

const GITHUB_API_URL = "https://api.github.com";

// The token currently in use, and the cached `gh` CLI lookup (one spawn/process).
let activeToken: string | null = null;
let cliTokenCache: string | null | undefined; // undefined = not yet checked
let warnedFallback = false;

/** Read a token from the `gh` CLI, or null if unavailable / not logged in. */
function ghCliToken(): string | null {
  if (cliTokenCache !== undefined) return cliTokenCache;
  try {
    // `gh` echoes back GITHUB_TOKEN/GH_TOKEN if they're set, so strip them to
    // get the CLI's own (keyring) token rather than an env token.
    const env = { ...process.env };
    delete env.GITHUB_TOKEN;
    delete env.GH_TOKEN;
    const proc = Bun.spawnSync(["gh", "auth", "token"], { env });
    cliTokenCache =
      proc.exitCode === 0 ? proc.stdout.toString().trim() || null : null;
  } catch {
    // gh not installed or not on PATH.
    cliTokenCache = null;
  }
  return cliTokenCache;
}

/** Candidate tokens in priority order: gh CLI first, then GITHUB_TOKEN env. */
function candidateTokens(): string[] {
  const tokens: string[] = [];
  const cli = ghCliToken();
  if (cli) tokens.push(cli);
  const envToken = Bun.env.GITHUB_TOKEN?.trim();
  if (envToken && !tokens.includes(envToken)) tokens.push(envToken);
  return tokens;
}

export function getToken(): string {
  if (activeToken) return activeToken;
  const candidates = candidateTokens();
  if (candidates.length === 0) {
    throw new Error(
      "No GitHub token found. Run `gh auth login` (preferred) " +
        "or set GITHUB_TOKEN in your environment (.env)."
    );
  }
  activeToken = candidates[0]!;
  return activeToken;
}

export function ghHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getToken()}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "spelling-bee-js",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function ghFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { ...ghHeaders(), ...(init.headers as Record<string, string>) },
  });
}

/**
 * Thin wrapper around fetch for the GitHub REST API.
 * Accepts a path (e.g. "/user") or a full URL, attaches auth headers, and
 * throws a descriptive error on non-2xx responses. Returns parsed JSON, or
 * null for empty bodies (e.g. 204 No Content).
 *
 * On a 401 it tries the next candidate token (e.g. a stale GITHUB_TOKEN falls
 * through to the gh CLI token), so a bad token doesn't block a logged-in user.
 */
export async function gh<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = path.startsWith("http") ? path : `${GITHUB_API_URL}${path}`;
  let res = await ghFetch(url, init);

  if (res.status === 401) {
    for (const token of candidateTokens()) {
      if (token === activeToken) continue;
      if (!warnedFallback) {
        console.warn("GitHub token rejected (401); trying another credential.");
        warnedFallback = true;
      }
      activeToken = token; // subsequent calls (and git pushes) reuse this token
      res = await ghFetch(url, init);
      if (res.status !== 401) break;
    }
  }

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
