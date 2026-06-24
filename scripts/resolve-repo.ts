import type { RepoMetadata } from "./fetch-trending-repos";
import { gh } from "./github";

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
  let repo: any;
  try {
    repo = await gh(`/repos/${owner}/${name}`);
  } catch (err) {
    if ((err as Error).message.includes("404")) {
      throw new Error(`Repository not found: ${owner}/${name}`);
    }
    throw err;
  }
  return {
    name: repo.name,
    owner: repo.owner.login,
    url: repo.html_url,
    description: repo.description,
    stars: repo.stargazers_count,
    language: repo.language || null,
  };
}
