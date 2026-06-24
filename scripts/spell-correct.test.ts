import { test, expect } from "bun:test";
import { correctSpelling, type Correction } from "./spell-correct";

test("auto-corrects misspelled words in non-interactive mode", async () => {
  const input = "Ths is a smple sentence with errrors.";
  const corrections: Correction[] = [];
  const out = await correctSpelling(input, "test.txt", {
    autoYes: true,
    onCorrection: (c) => corrections.push(c),
  });
  expect(out).not.toBe(input);
  expect(corrections.length).toBeGreaterThan(0);
  // Every recorded correction should actually differ from its source word.
  for (const c of corrections) expect(c.from).not.toBe(c.to);
});

test("leaves correctly-spelled text untouched", async () => {
  const input = "This is a simple sentence with no errors.";
  const out = await correctSpelling(input, "test.txt", { autoYes: true });
  expect(out).toBe(input);
});

test("preserves fenced code blocks", async () => {
  const input = "Some text.\n\n```\nthsi is codez insde a fence\n```\n";
  const out = await correctSpelling(input, "test.md", { autoYes: true });
  // The fenced lines must survive verbatim.
  expect(out).toContain("thsi is codez insde a fence");
});

test("preserves CRLF line endings (no normalization churn)", async () => {
  // A Windows-line-ending file with no misspellings must come back byte-for-byte
  // identical -- otherwise CRLF->LF normalization alone triggers empty PRs.
  const input = "This is fine.\r\nSo is this.\r\n";
  const corrections: Correction[] = [];
  const out = await correctSpelling(input, "test.txt", {
    autoYes: true,
    onCorrection: (c) => corrections.push(c),
  });
  expect(out).toBe(input);
  expect(corrections).toHaveLength(0);
});

test("keeps CRLF endings even when correcting a typo", async () => {
  const input = "This sentance is wrong.\r\nThis line is fine.\r\n";
  const out = await correctSpelling(input, "test.txt", { autoYes: true });
  expect(out).toContain("sentence");
  expect(out).toContain("\r\n"); // surviving lines keep their CRLF
  expect(out.endsWith("\r\n")).toBe(true);
});

test("does not flag URLs or emails", async () => {
  const input = "See https://github.com/foo/barbaz or email me@exmaple.com.";
  const out = await correctSpelling(input, "test.txt", { autoYes: true });
  expect(out).toContain("https://github.com/foo/barbaz");
  expect(out).toContain("me@exmaple.com");
});

test("corrects prose in .rst and .txt files too", async () => {
  for (const file of ["docs.rst", "notes.text"]) {
    const input = "This sentance has a typo.";
    const out = await correctSpelling(input, file, { autoYes: true });
    expect(out).not.toBe(input);
    expect(out).toContain("sentence");
  }
});

test("does not flag technical terms, brands, or acronyms", async () => {
  // The whole reason for the cspell engine: these are real words in a
  // developer's vocabulary and must not be reported as misspellings.
  const input =
    "We render with WebGL, deploy via GitHub Actions, and send JSON over HTTP.";
  const corrections: Correction[] = [];
  const out = await correctSpelling(input, "README.md", {
    autoYes: true,
    onCorrection: (c) => corrections.push(c),
  });
  expect(out).toBe(input);
  expect(corrections).toHaveLength(0);
});
