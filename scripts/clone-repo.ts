import { $ } from "bun";
import { randomBytes } from "crypto";

const GITHUB_API = "https://api.github.com";
// Skip repositories larger than this to keep clones fast and disk usage sane.
const MAX_REPO_MB = 200;

export interface CloneRepoOptions {
  owner: string;
  repo: string;
  branch?: string;
  token?: string; // Optional, for private repos in the future
}

export interface CloneRepoResult {
  dir: string;
  branch: string;
}

/**
 * Clones the specified GitHub repo's default branch (or provided branch) into a unique /tmp directory.
 * Returns the directory path and branch used.
 */
export async function cloneRepo({
  owner,
  repo,
  branch,
  token,
}: CloneRepoOptions): Promise<CloneRepoResult> {
  // 1. Fetch repo metadata (always, for size check)
  const apiUrl = `${GITHUB_API}/repos/${owner}/${repo}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const resp = await fetch(apiUrl, { headers });
  if (!resp.ok) {
    throw new Error(
      `Failed to fetch repo metadata: ${resp.status} ${resp.statusText}`
    );
  }
  const data: any = await resp.json();
  const sizeKB = data.size;
  const sizeMB = sizeKB / 1024;
  console.log(`Estimated download size: ${sizeMB.toFixed(2)} MB.`);
  if (sizeMB > MAX_REPO_MB) {
    throw new Error(
      `Repository is too large (${sizeMB.toFixed(2)} MB). Skipping clone.`
    );
  }

  // 2. Determine branch if not provided
  let branchToClone = branch;
  if (!branchToClone) {
    branchToClone = data.default_branch;
    if (!branchToClone) throw new Error("Could not determine default branch.");
  }

  // 3. Generate unique /tmp dir
  let tmpDir = "";
  for (let i = 0; i < 5; i++) {
    const rand = randomBytes(6).toString("hex");
    tmpDir = `/tmp/spelling-bee-${rand}`;
    try {
      await Bun.write(`${tmpDir}/.touch`, ""); // Try to create a file to check if dir exists
      Bun.spawnSync({ cmd: ["rm", `${tmpDir}/.touch`] });
      break;
    } catch {
      // Directory exists, try again
      if (i === 4)
        throw new Error(
          "Failed to generate unique temp directory after 5 attempts."
        );
    }
  }

  // 4. Clone repo
  const repoUrl = `https://github.com/${owner}/${repo}.git`;
  console.log(`Cloning ${repoUrl} into ${tmpDir}`);
  try {
    await $`git clone --depth 1 --branch ${branchToClone} ${repoUrl} ${tmpDir}`;
  } catch (err) {
    throw new Error(`git clone failed: ${(err as Error).message}`);
  }

  if (!tmpDir) throw new Error("Temporary directory was not assigned.");
  return { dir: tmpDir, branch: branchToClone };
}

// Allow running this module directly for a quick manual clone:
//   bun run scripts/clone-repo.ts <owner> <repo> [branch]
if (import.meta.main) {
  const [owner, repo, branch] = process.argv.slice(2);
  if (!owner || !repo) {
    console.error("Usage: bun run scripts/clone-repo.ts <owner> <repo> [branch]");
    process.exit(1);
  }
  cloneRepo({ owner, repo, branch })
    .then((result) =>
      console.log("Cloned to:", result.dir, "Branch:", result.branch)
    )
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
