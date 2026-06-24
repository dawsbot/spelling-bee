import { findTextFiles } from "./find-text-files";
import { correctSpelling, type Correction } from "./spell-correct";
import { readFile, writeFile } from "fs/promises";
import { relative } from "path";

export interface DetectAndCorrectOptions {
  /** Non-interactive: auto-apply top suggestions. */
  autoYes?: boolean;
  /** Print per-file progress. Defaults to true. */
  verbose?: boolean;
}

export interface DetectAndCorrectResult {
  /** Relative paths of files that were modified. */
  changedFiles: string[];
  /** Total text files scanned. */
  scanned: number;
  /** Every correction applied, across all files. */
  corrections: Correction[];
}

/**
 * Scan a directory for supported text files, apply spelling corrections,
 * and write changes back to disk. Returns a summary of what changed so the
 * caller can decide whether to open a PR.
 */
export async function detectAndCorrect(
  rootDir: string,
  opts: DetectAndCorrectOptions = {}
): Promise<DetectAndCorrectResult> {
  const { autoYes = false, verbose = true } = opts;
  const files = await findTextFiles(rootDir);
  const changedFiles: string[] = [];
  const corrections: Correction[] = [];

  for (const file of files) {
    const rel = relative(rootDir, file);
    const orig = await readFile(file, "utf8");
    const corrected = await correctSpelling(orig, rel, {
      autoYes,
      onCorrection: (c) => corrections.push({ ...c, file: rel }),
    });
    if (orig !== corrected) {
      await writeFile(file, corrected, "utf8");
      changedFiles.push(rel);
      if (verbose) console.log(`Corrected: ${rel}`);
    } else if (verbose) {
      console.log(`No changes: ${rel}`);
    }
  }

  return { changedFiles, scanned: files.length, corrections };
}

// CLI: bun run scripts/detect-and-correct-spelling.ts <repo-root-dir> [--yes]
if (import.meta.main) {
  const args = process.argv.slice(2);
  const rootDir = args.find((a) => !a.startsWith("--"));
  const autoYes = args.includes("--yes");
  if (!rootDir) {
    console.error(
      "Usage: bun run scripts/detect-and-correct-spelling.ts <repo-root-dir> [--yes]"
    );
    process.exit(1);
  }
  detectAndCorrect(rootDir, { autoYes })
    .then(({ changedFiles, scanned }) => {
      console.log(
        `\n${changedFiles.length} file(s) corrected out of ${scanned}.`
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("Error during spelling correction:", err);
      process.exit(1);
    });
}
