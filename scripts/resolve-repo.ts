import type { RepoMetadata } from "./fetch-trending-repos";

const GITHUB_API_URL = "https://api.github.com";

function getAuthHeaders() {
  const token = Bun.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not set in environment");
  return {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "spelling-bee-js",
  };
}

function parseRepoInput(input: string): { owner: string; name: string } | null {
  // Accepts: owner/repo or https://github.com/owner/repo
  const urlMatch = input.match(
    /^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)(?:\/|$)/i
  );
  if (urlMatch && urlMatch[1] && urlMatch[2]) {
    return { owner: urlMatch[1], name: urlMatch[2] };
  }
  const simpleMatch = input.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (simpleMatch && simpleMatch[1] && simpleMatch[2]) {
    return { owner: simpleMatch[1], name: simpleMatch[2] };
  }
  return null;
}

export async function resolveRepo(input: string): Promise<RepoMetadata> {
  const parsed = parseRepoInput(input);
  if (!parsed) {
    throw new Error(
      `Invalid repository input. Use 'owner/repo' or a valid GitHub repo URL.`
    );
  }
  const { owner, name } = parsed;
  const url = `${GITHUB_API_URL}/repos/${owner}/${name}`;
  const res = await fetch(url, { headers: getAuthHeaders() });
  if (res.status === 404) {
    throw new Error(`Repository not found: ${owner}/${name}`);
  }
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }
  const repo = (await res.json()) as any;
  return {
    name: repo.name,
    owner: repo.owner.login,
    url: repo.html_url,
    description: repo.description,
    stars: repo.stargazers_count,
    language: repo.language || null,
  };
}
