// Fetch trending GitHub repositories using the GitHub REST API
// Uses 'conf' for persistent disk-based caching (24 hours)
// Authenticates via the shared gh() helper (gh CLI token or GITHUB_TOKEN)

import Conf from "conf";
import { gh } from "./github";

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
    const url = `/search/repositories?q=language:${encodeURIComponent(
      lang
    )}+created:>${lastWeek}&sort=stars&order=desc&per_page=20`;
    const json = (await gh(url)) as any;
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
