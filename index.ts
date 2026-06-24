import { $ } from "bun";
import { resolveRepo } from "./scripts/resolve-repo";
import { cloneRepo } from "./scripts/clone-repo";
import { detectAndCorrect } from "./scripts/detect-and-correct-spelling";
import { openPr, cleanupForks } from "./scripts/open-pr";
import { fetchTrendingRepos } from "./scripts/fetch-trending-repos";

interface RunOptions {
  autoYes: boolean;
  dryRun: boolean;
}

const USAGE = `spelling-bee — fix spelling in GitHub repos and open PRs

Usage:
  bun run index.ts <owner/repo | github-url>   Fix one repository
  bun run index.ts --trending [--limit N]      Fix N trending repos (default 5)
  bun run index.ts --cleanup                   Delete forks for merged/closed PRs

Options:
  --yes        Non-interactive: auto-apply the top spelling suggestion
  --dry-run    Show what would change without forking or opening a PR
  --limit N    Number of trending repos to process (with --trending)
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
  console.log(`\n→ ${meta.owner}/${meta.name} (${meta.stars}★)`);

  const { dir, branch } = await cloneRepo({
    owner: meta.owner,
    repo: meta.name,
  });

  try {
    const { changedFiles, scanned, corrections } = await detectAndCorrect(dir, {
      autoYes: opts.autoYes,
      verbose: !opts.autoYes,
    });

    if (changedFiles.length === 0) {
      console.log(`  No spelling fixes found (${scanned} files scanned).`);
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
    const limitIdx = args.indexOf("--limit");
    const limit =
      limitIdx !== -1 && args[limitIdx + 1] ? Number(args[limitIdx + 1]) : 5;
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
