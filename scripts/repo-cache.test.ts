import { test, expect } from "bun:test";
import { hasSeenRepo, markRepoSeen, getSeenRepos, repoKey } from "./repo-cache";

// The config store is redirected to a throwaway dir by test-setup.ts (preload),
// so these tests never touch the developer's real seen-repo cache.

test("normalizes slugs, URLs, and .git suffixes to a stable key", () => {
  expect(repoKey("Owner/Repo")).toBe("owner/repo");
  expect(repoKey("https://github.com/Owner/Repo.git")).toBe("owner/repo");
  expect(repoKey("  owner/repo/ ")).toBe("owner/repo");
});

test("an unseen repo is not cached", () => {
  expect(hasSeenRepo("never/seen")).toBe(false);
});

test("marking a repo seen persists and matches regardless of form", () => {
  markRepoSeen("kanavtwtgg/birds.cafe");
  expect(hasSeenRepo("kanavtwtgg/birds.cafe")).toBe(true);
  // Different surface forms of the same repo resolve to the same key.
  expect(hasSeenRepo("KanavTwtgg/Birds.Cafe")).toBe(true);
  expect(hasSeenRepo("https://github.com/kanavtwtgg/birds.cafe.git")).toBe(true);
});

test("marking the same repo twice does not duplicate it", () => {
  const before = getSeenRepos().size;
  markRepoSeen("dup/repo");
  markRepoSeen("DUP/repo");
  const after = getSeenRepos().size;
  expect(after).toBe(before + 1);
});
