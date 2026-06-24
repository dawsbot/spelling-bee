import { test, expect } from "bun:test";
import { findTextFiles } from "./find-text-files";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

test("finds .md/.txt/.rtf files and skips other extensions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sb-find-"));
  writeFileSync(join(dir, "readme.md"), "x");
  writeFileSync(join(dir, "notes.txt"), "x");
  writeFileSync(join(dir, "doc.rtf"), "x");
  writeFileSync(join(dir, "index.js"), "x");
  writeFileSync(join(dir, "data.json"), "x");

  const files = await findTextFiles(dir);
  expect(files.map((f) => f.split("/").pop()!).sort()).toEqual([
    "doc.rtf",
    "notes.txt",
    "readme.md",
  ]);
});

test("respects .gitignore", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sb-ignore-"));
  mkdirSync(join(dir, "vendor"));
  writeFileSync(join(dir, ".gitignore"), "vendor/\n");
  writeFileSync(join(dir, "keep.md"), "x");
  writeFileSync(join(dir, "vendor", "skip.md"), "x");

  const files = await findTextFiles(dir);
  expect(files.map((f) => f.split("/").pop()!)).toEqual(["keep.md"]);
});
