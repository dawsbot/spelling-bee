// Fetch trending GitHub repositories using the GitHub REST API
// Uses 'conf' for persistent disk-based caching (24 hours)
// Requires GITHUB_TOKEN in Bun.env

import Conf from "conf";

const GITHUB_API_URL = "https://api.github.com";
const CACHE_KEY = "trendingRepos";
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

const conf = new Conf<{
  trendingRepos: { timestamp: number; data: RepoMetadata[] };
}>({ projectName: "spelling-bee-js" });

export interface RepoMetadata {
  name: string;
  owner: string;
  url: string;
  description: string;
  stars: number;
  language: string | null;
}

function getAuthHeaders() {
  const token = Bun.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not set in environment");
  return {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "spelling-bee-js",
  };
}

const LANGUAGES = [
  "JavaScript",
  "Python",
  "TypeScript",
  "Go",
  "Rust",
  "Java",
  "C++",
  "C#",
  "PHP",
  "Ruby",
  "Kotlin",
  "Swift",
  "Shell",
  "C",
  "Scala",
  "Dart",
  "Elixir",
  "Haskell",
  "Perl",
  "Objective-C",
  "R",
];

export async function fetchTrendingRepos(): Promise<RepoMetadata[]> {
  // Check persistent cache
  const cached = conf.get(CACHE_KEY);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
    return cached.data;
  }

  const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const allRepos: RepoMetadata[] = [];
  const seen = new Set<string>();

  for (const lang of LANGUAGES) {
    const url = `${GITHUB_API_URL}/search/repositories?q=language:${encodeURIComponent(
      lang
    )}+created:>${lastWeek}&sort=stars&order=desc&per_page=20`;
    const res = await fetch(url, {
      headers: getAuthHeaders(),
    });
    if (res.status === 403) {
      const reset = res.headers.get("x-ratelimit-reset");
      const resetTime = reset ? new Date(Number(reset) * 1000) : null;
      throw new Error(
        `GitHub API rate limit exceeded. Try again after ${resetTime}`
      );
    }
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as any;
    for (const repo of json.items || []) {
      const fullName = `${repo.owner.login}/${repo.name}`;
      if (!seen.has(fullName)) {
        seen.add(fullName);
        allRepos.push({
          name: repo.name,
          owner: repo.owner.login,
          url: repo.html_url,
          description: repo.description,
          stars: repo.stargazers_count,
          language: repo.language || null,
        });
      }
    }
  }

  conf.set(CACHE_KEY, { timestamp: Date.now(), data: allRepos });
  return allRepos;
}
