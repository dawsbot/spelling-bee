import { findTextFiles } from "./find-text-files";
import { correctSpelling } from "./spell-correct";
import { readFile, writeFile } from "fs/promises";
import { relative } from "path";

const rootDir = process.argv[2];
if (!rootDir) {
  console.error(
    "Usage: bun run detect-and-correct-spelling.ts <repo-root-dir>"
  );
  process.exit(1);
}

(async () => {
  try {
    const files = await findTextFiles(rootDir);
    if (files.length === 0) {
      console.log("No text files found.");
      process.exit(0);
    }
    let totalChanged = 0;
    for (const file of files) {
      const orig = await readFile(file, "utf8");
      const corrected = await correctSpelling(
        orig,
        file.replace(/^\/tmp\/[^/]+\//, "")
      );
      if (orig !== corrected) {
        await writeFile(file, corrected, "utf8");
        totalChanged++;
        console.log(`Corrected: ${relative(rootDir, file)}`);
      } else {
        console.log(`No changes: ${relative(rootDir, file)}`);
      }
    }
    console.log(`\n${totalChanged} file(s) corrected out of ${files.length}.`);
    process.exit(0);
  } catch (err) {
    console.error("Error during spelling correction:", err);
    process.exit(1);
  }
})();
