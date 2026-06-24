import { test, expect } from "bun:test";
import { findTextFiles } from "./find-text-files";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

test("finds prose files and skips code, config, and rtf", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sb-find-"));
  writeFileSync(join(dir, "readme.md"), "x");
  writeFileSync(join(dir, "guide.markdown"), "x");
  writeFileSync(join(dir, "notes.txt"), "x");
  writeFileSync(join(dir, "notes.text"), "x");
  writeFileSync(join(dir, "docs.rst"), "x");
  writeFileSync(join(dir, "doc.rtf"), "x"); // control-word format, excluded
  writeFileSync(join(dir, "index.js"), "x");
  writeFileSync(join(dir, "data.json"), "x");

  const files = await findTextFiles(dir);
  expect(files.map((f) => f.split("/").pop()!).sort()).toEqual([
    "docs.rst",
    "guide.markdown",
    "notes.text",
    "notes.txt",
    "readme.md",
  ]);
});

test("skips translated docs but keeps English ones", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sb-i18n-"));
  mkdirSync(join(dir, "i18n"));
  // Foreign-language translations that should be excluded.
  for (const lang of ["ar", "de", "ja", "pt-BR", "zh-CN", "ko", "ru"]) {
    writeFileSync(join(dir, "i18n", `README.${lang}.md`), "x");
  }
  // These must still be scanned.
  writeFileSync(join(dir, "README.md"), "x");
  writeFileSync(join(dir, "README.en.md"), "x");
  writeFileSync(join(dir, "v2.md"), "x"); // ".v2" is not a language tag

  const files = await findTextFiles(dir);
  expect(files.map((f) => f.split("/").pop()!).sort()).toEqual([
    "README.en.md",
    "README.md",
    "v2.md",
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
