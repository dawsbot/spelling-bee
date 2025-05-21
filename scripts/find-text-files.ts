import { readdir } from "fs/promises";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import ignore from "ignore";

const TEXT_FILE_EXTENSIONS = [".md", ".txt", ".rtf"];

function isTextFile(filename: string): boolean {
  return TEXT_FILE_EXTENSIONS.some((ext) =>
    filename.toLowerCase().endsWith(ext)
  );
}

export async function findTextFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];
  let ig: ReturnType<typeof ignore> | null = null;
  const gitignorePath = join(rootDir, ".gitignore");
  if (existsSync(gitignorePath)) {
    const gitignoreContent = readFileSync(gitignorePath, "utf8");
    ig = ignore().add(gitignoreContent);
  }

  async function scan(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = join(dir, entry.name).replace(rootDir + "/", "");
      const fullPath = join(dir, entry.name);
      if (ig && ig.ignores(relPath)) continue;
      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile() && isTextFile(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  await scan(rootDir);
  return results;
}
