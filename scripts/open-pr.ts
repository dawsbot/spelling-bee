import { $ } from "bun";
import Conf from "conf";
import { gh, getToken } from "./github";
import type { Correction } from "./spell-correct";

const BRANCH = "spelling-bee/spelling-fixes";
const conf = new Conf<{ openPRs: TrackedPR[] }>({
  projectName: "spelling-bee-js",
});
const OPEN_PRS_KEY = "openPRs";

export interface TrackedPR {
  owner: string;
  repo: string;
  prNumber: number;
  forkFullName: string; // "login/repo"
  url: string;
}

export interface OpenPrOptions {
  owner: string;
  repo: string;
  /** Local directory containing the cloned repo with applied changes. */
  dir: string;
  /** Base branch the PR should target (the cloned default branch). */
  baseBranch: string;
  corrections: Correction[];
}

export interface OpenPrResult {
  url: string;
  prNumber: number;
  forkFullName: string;
}

function buildPrBody(corrections: Correction[]): string {
  const byFile = new Map<string, Correction[]>();
  for (const c of corrections) {
    const list = byFile.get(c.file) ?? [];
    list.push(c);
    byFile.set(c.file, list);
  }
  const lines: string[] = [
    "## Spelling fixes",
    "",
    "This PR fixes spelling mistakes found in the project's documentation and text files. It was generated automatically by [spelling-bee-js](https://github.com/dawsbot/spelling-bee-js).",
    "",
    `**${corrections.length} correction(s) across ${byFile.size} file(s):**`,
    "",
  ];
  for (const [file, list] of byFile) {
    lines.push(`### \`${file}\``);
    for (const c of list) {
      lines.push(`- \`${c.from}\` → \`${c.to}\``);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Fork the target repo, push the locally-applied spelling fixes to a branch on
 * the fork, and open a pull request against the upstream repo. The fork is
 * recorded so it can later be deleted via `cleanupForks()`.
 */
export async function openPr({
  owner,
  repo,
  dir,
  baseBranch,
  corrections,
}: OpenPrOptions): Promise<OpenPrResult> {
  const token = getToken();

  // 1. Identify the authenticated user (fork owner + commit identity).
  const user = await gh<{ login: string; id: number; name: string | null }>(
    "/user"
  );
  const login = user.login;

  // 2. Fork the repository (idempotent: returns the existing fork if present).
  const fork = await gh<{ full_name: string; name: string }>(
    `/repos/${owner}/${repo}/forks`,
    { method: "POST" }
  );
  const forkFullName = fork.full_name; // "login/repo"
  const forkName = fork.name;

  // 3. Wait until the fork is actually available (forking is asynchronous).
  await waitForFork(forkFullName);

  // 4. Stage, commit, and push the changes to the fork.
  const email = `${user.id}+${login}@users.noreply.github.com`;
  const name = user.name || login;
  const remoteUrl = `https://x-access-token:${token}@github.com/${forkFullName}.git`;

  const git = (...args: string[]) => $`git -C ${dir} ${args}`.quiet();

  await git("checkout", "-B", BRANCH);
  await git("add", "-A");
  await git(
    "-c",
    `user.name=${name}`,
    "-c",
    `user.email=${email}`,
    "commit",
    "-m",
    "Fix spelling mistakes"
  );
  // Use a one-off authenticated remote so the token never lands in tracked config.
  await git("remote", "remove", "fork").catch(() => {});
  await git("remote", "add", "fork", remoteUrl);
  await git("push", "--force", "fork", `HEAD:${BRANCH}`);

  // 5. Open the pull request against upstream.
  const pr = await gh<{ number: number; html_url: string }>(
    `/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title: "Fix spelling mistakes",
        head: `${login}:${BRANCH}`,
        base: baseBranch,
        body: buildPrBody(corrections),
        maintainer_can_modify: true,
      }),
    }
  );

  const result: OpenPrResult = {
    url: pr.html_url,
    prNumber: pr.number,
    forkFullName,
  };

  // 6. Track the fork/PR so we can clean up the fork after the PR closes.
  trackPr({ owner, repo, prNumber: pr.number, forkFullName, url: pr.html_url });

  return result;
}

async function waitForFork(forkFullName: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await gh(`/repos/${forkFullName}`);
      return;
    } catch {
      await Bun.sleep(2000);
    }
  }
  throw new Error(`Fork ${forkFullName} did not become available in time.`);
}

function trackPr(pr: TrackedPR): void {
  const list = conf.get(OPEN_PRS_KEY, []);
  list.push(pr);
  conf.set(OPEN_PRS_KEY, list);
}

/**
 * Delete forks for any tracked PRs that have since been merged or closed.
 * Requires the token to have the `delete_repo` scope.
 */
export async function cleanupForks(): Promise<void> {
  const tracked = conf.get(OPEN_PRS_KEY, []);
  if (tracked.length === 0) {
    console.log("No tracked PRs to clean up.");
    return;
  }

  const remaining: TrackedPR[] = [];
  for (const t of tracked) {
    let state = "unknown";
    try {
      const pr = await gh<{ state: string; merged: boolean }>(
        `/repos/${t.owner}/${t.repo}/pulls/${t.prNumber}`
      );
      state = pr.state; // "open" | "closed"
    } catch {
      // PR fetch failed (deleted upstream?). Treat as closed so we can clean up.
      state = "closed";
    }

    if (state === "open") {
      remaining.push(t);
      continue;
    }

    try {
      await gh(`/repos/${t.forkFullName}`, { method: "DELETE" });
      console.log(`Deleted fork ${t.forkFullName} (PR #${t.prNumber} ${state}).`);
    } catch (err) {
      console.warn(
        `Could not delete fork ${t.forkFullName}: ${(err as Error).message}\n` +
          "  (the token may be missing the 'delete_repo' scope)"
      );
      remaining.push(t); // keep it so a future run can retry
    }
  }

  conf.set(OPEN_PRS_KEY, remaining);
}

// CLI: bun run scripts/open-pr.ts --cleanup
if (import.meta.main) {
  if (process.argv.includes("--cleanup")) {
    cleanupForks()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  } else {
    console.error("Usage: bun run scripts/open-pr.ts --cleanup");
    process.exit(1);
  }
}
