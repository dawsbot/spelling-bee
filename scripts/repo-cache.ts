import Conf from "conf";

// Persistent record of repositories we've already processed (PR opened, no
// fixes found, or explicitly skipped by the reviewer). On future runs we skip
// these before ever cloning them. Shares the project's config store; the
// SPELLING_BEE_CONFIG_DIR override exists so tests can use a throwaway dir.
const cwd = process.env.SPELLING_BEE_CONFIG_DIR;
const conf = new Conf<{ seenRepos: string[] }>({
  projectName: "spelling-bee-js",
  ...(cwd ? { cwd } : {}),
});

const SEEN_REPOS_KEY = "seenRepos";

/** Normalize "Owner/Repo", a URL, or a ".git" suffix to a stable cache key. */
export function repoKey(slug: string): string {
  return slug
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

export function getSeenRepos(): Set<string> {
  return new Set(conf.get(SEEN_REPOS_KEY, []));
}

/** Have we processed this repo before (and therefore should skip it)? */
export function hasSeenRepo(slug: string): boolean {
  return getSeenRepos().has(repoKey(slug));
}

/** Record a repo so it is skipped before cloning on every future run. */
export function markRepoSeen(slug: string): void {
  const seen = getSeenRepos();
  seen.add(repoKey(slug));
  conf.set(SEEN_REPOS_KEY, Array.from(seen));
}
