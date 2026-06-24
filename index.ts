import { $ } from "bun";
import { resolveRepo } from "./scripts/resolve-repo";
import { cloneRepo } from "./scripts/clone-repo";
import { detectAndCorrect } from "./scripts/detect-and-correct-spelling";
import { SkipRepoError } from "./scripts/spell-correct";
import { openPr, cleanupForks } from "./scripts/open-pr";
import { fetchTrendingRepos } from "./scripts/fetch-trending-repos";
import { hasSeenRepo, markRepoSeen } from "./scripts/repo-cache";

// Ctrl+C quits the whole program. The --trending loop swallows per-repo errors
// to keep going, so without this an interrupt could be mistaken for one repo
// failing and move on to the next. (Interrupts raised while an interactive
// prompt holds the terminal in raw mode are handled in spell-correct.ts.)
process.on("SIGINT", () => {
  console.log("\nAborted.");
  process.exit(130);
});

interface RunOptions {
  autoYes: boolean;
  dryRun: boolean;
}

const USAGE = `spelling-bee — fix spelling in GitHub repos and open PRs

Usage:
  bun run index.ts <owner/repo | github-url>   Fix one repository
  bun run index.ts --trending [N]              Fix N trending repos (default 5)
  bun run index.ts --cleanup                   Delete forks for merged/closed PRs

Options:
  --yes        Non-interactive: auto-apply the top spelling suggestion
  --dry-run    Show what would change without forking or opening a PR
  --limit N    Number of trending repos to process (alias for --trending N)
  --help       Show this help
`;

async function removeTempDir(dir: string): Promise<void> {
  // Guard against ever rm -rf'ing something outside our temp namespace.
  if (!dir.startsWith("/tmp/spelling-bee-")) return;
  await $`rm -rf ${dir}`.quiet().catch(() => {});
}

/** Run the full pipeline for a single repo. Returns the PR url if one opened. */
async function processRepo(
  input: string,
  opts: RunOptions
): Promise<string | null> {
  const meta = await resolveRepo(input);
  const slug = `${meta.owner}/${meta.name}`;

  // Never clone a repo we've already processed or skipped.
  if (hasSeenRepo(slug)) {
    console.log(`\n→ ${slug}: already seen, skipping (cached).`);
    return null;
  }

  console.log(`\n→ ${slug} (${meta.stars}★)`);

  const { dir, branch } = await cloneRepo({
    owner: meta.owner,
    repo: meta.name,
  });

  try {
    let result;
    try {
      result = await detectAndCorrect(dir, {
        autoYes: opts.autoYes,
        verbose: !opts.autoYes,
      });
    } catch (err) {
      if (err instanceof SkipRepoError) {
        // Reviewer chose "*skip repo*": remember it so we never clone it again.
        markRepoSeen(slug);
        console.log(`  Skipped ${slug}; it won't be cloned again.`);
        return null;
      }
      throw err;
    }

    const { changedFiles, scanned, corrections } = result;

    if (changedFiles.length === 0 || corrections.length === 0) {
      console.log(`  No spelling fixes found (${scanned} files scanned).`);
      // A dry run is exploratory, so don't permanently mark the repo seen.
      if (!opts.dryRun) markRepoSeen(slug);
      return null;
    }

    console.log(
      `  ${corrections.length} fix(es) across ${changedFiles.length} file(s).`
    );

    if (opts.dryRun) {
      console.log("  --dry-run: not forking or opening a PR. Diff stat:");
      await $`git -C ${dir} --no-pager diff --stat`;
      return null;
    }

    const pr = await openPr({
      owner: meta.owner,
      repo: meta.name,
      dir,
      baseBranch: branch,
      corrections,
    });
    console.log(`  ✓ Opened PR: ${pr.url}`);
    markRepoSeen(slug);
    return pr.url;
  } finally {
    await removeTempDir(dir);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.length === 0) {
    console.log(USAGE);
    process.exit(args.length === 0 ? 1 : 0);
  }

  const opts: RunOptions = {
    autoYes: args.includes("--yes"),
    dryRun: args.includes("--dry-run"),
  };

  if (args.includes("--cleanup")) {
    await cleanupForks();
    return;
  }

  if (args.includes("--trending")) {
    // Limit can be given as `--limit N` or as a bare number, e.g.
    // `--trending 50`. Falls back to 5.
    const limitIdx = args.indexOf("--limit");
    const rawLimit =
      limitIdx !== -1 ? args[limitIdx + 1] : args.find((a) => /^\d+$/.test(a));
    const parsed = Number(rawLimit);
    const limit = Number.isInteger(parsed) && parsed > 0 ? parsed : 5;
    const repos = await fetchTrendingRepos();
    const targets = repos.slice(0, limit);
    console.log(`Processing ${targets.length} trending repo(s)...`);
    for (const r of targets) {
      try {
        await processRepo(`${r.owner}/${r.name}`, opts);
      } catch (err) {
        // Isolate failures so one bad repo doesn't abort the whole batch.
        console.error(`  ✗ ${r.owner}/${r.name}: ${(err as Error).message}`);
      }
    }
    return;
  }

  const input = args.find((a) => !a.startsWith("--"));
  if (!input) {
    console.error("No repository specified.\n");
    console.log(USAGE);
    process.exit(1);
  }
  await processRepo(input, opts);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
