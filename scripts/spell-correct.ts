const { Select } = require("enquirer");
import Conf from "conf";
import {
  spellCheckDocument,
  getDefaultSettings,
  mergeSettings,
} from "cspell-lib";
const path = require("path");

let settingsPromise: Promise<any> | null = null;
// SPELLING_BEE_CONFIG_DIR redirects the store to a throwaway dir so tests don't
// read or mutate the real user config. Unset in normal use.
const configCwd = process.env.SPELLING_BEE_CONFIG_DIR;
const conf = new Conf<{ ignoredWords: string[]; ignoredDirectories: string[] }>(
  {
    projectName: "spelling-bee-js",
    ...(configCwd ? { cwd: configCwd } : {}),
  }
);
const IGNORED_KEY = "ignoredWords";
const IGNORED_DIRS_KEY = "ignoredDirectories";
const TEMP_IGNORED_KEY = "tempIgnoredWords";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Utility regexes for skipping emails and URLs
const EMAIL_REGEX = /[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}/;
const URL_REGEX = /https?:\/\/\S+|www\.[^\s]+/;

function getIgnoredWords(): Set<string> {
  return new Set(conf.get(IGNORED_KEY, []));
}

function addIgnoredWord(word: string) {
  const words = new Set(conf.get(IGNORED_KEY, []));
  words.add(word.toLowerCase());
  conf.set(IGNORED_KEY, Array.from(words));
}

function getIgnoredDirs(): Set<string> {
  return new Set(conf.get(IGNORED_DIRS_KEY, []));
}

function addIgnoredDir(dir: string) {
  const dirs = new Set(conf.get(IGNORED_DIRS_KEY, []));
  dirs.add(dir);
  conf.set(IGNORED_DIRS_KEY, Array.from(dirs));
}

function getTempIgnoredWords(): Set<string> {
  const now = Date.now();
  let tempList: { word: string; ts: number }[] = conf.get(TEMP_IGNORED_KEY, []);
  // Filter out expired entries
  tempList = tempList.filter(({ ts }) => now - ts < ONE_WEEK_MS);
  conf.set(TEMP_IGNORED_KEY, tempList); // Clean up expired
  return new Set(tempList.map(({ word }) => word.toLowerCase()));
}

function addTempIgnoredWord(word: string) {
  const now = Date.now();
  let tempList: { word: string; ts: number }[] = conf.get(TEMP_IGNORED_KEY, []);
  // Remove any existing entry for this word
  tempList = tempList.filter(
    (entry) => entry.word.toLowerCase() !== word.toLowerCase()
  );
  tempList.push({ word, ts: now });
  conf.set(TEMP_IGNORED_KEY, tempList);
}

export interface Correction {
  file: string;
  from: string;
  to: string;
}

export interface CorrectOptions {
  /** Non-interactive: auto-apply the top suggestion instead of prompting. */
  autoYes?: boolean;
  /** Invoked for every applied correction (used to build PR summaries). */
  onCorrection?: (correction: Correction) => void;
}

class IgnoreDirectoryError extends Error {
  constructor() {
    super("Ignore this directory");
  }
}

class IgnoreFileError extends Error {
  constructor() {
    super("Ignore this file");
  }
}

/** Thrown to abort the entire repository and never process it again. */
export class SkipRepoError extends Error {
  constructor() {
    super("Skip this repository");
  }
}

// cspell ships dictionaries for code, brands, and acronyms (WebGL, GitHub,
// JSON, npm, ...) and understands camelCase, so technical terms no longer read
// as misspellings the way they did under a plain English dictionary. We layer
// US + UK English on top of cspell's default software-term dictionaries.
async function getSettings(): Promise<any> {
  if (settingsPromise) return settingsPromise;
  settingsPromise = (async () =>
    mergeSettings(await getDefaultSettings(), {
      dictionaries: [
        "en_us",
        "en-gb",
        "softwareTerms",
        "companies",
        "filetypes",
        "computing-acronyms",
      ],
    }))();
  return settingsPromise;
}

interface Misspelling {
  word: string;
  /** Offset of the word within the supplied text fragment. */
  offset: number;
  length: number;
  suggestions: string[];
}

/** Run cspell over a fragment of prose and return its misspellings in order. */
async function findMisspellings(text: string): Promise<Misspelling[]> {
  const settings = await getSettings();
  const { issues } = await spellCheckDocument(
    { uri: "text://fragment.md", text, languageId: "markdown", locale: "en" },
    { generateSuggestions: true, numSuggestions: 10 },
    settings
  );
  return issues
    .map((issue: any): Misspelling => {
      const raw = issue.suggestionsEx ?? issue.suggestions ?? [];
      return {
        word: issue.text,
        offset: issue.offset,
        length: issue.length ?? issue.text.length,
        suggestions: raw.map((s: any) => (typeof s === "string" ? s : s.word)),
      };
    })
    .sort((a: Misspelling, b: Misspelling) => a.offset - b.offset);
}

async function promptForCorrection(
  word: string,
  suggestions: string[],
  prevLine: string,
  currLine: string,
  filePath: string,
  autoYes: boolean
): Promise<string> {
  // Non-interactive mode: accept the top suggestion without prompting.
  if (autoYes) {
    return suggestions[0] ?? word;
  }
  // Print context
  if (filePath) {
    // Print file path relative to repo root
    const repoRoot = process.cwd();
    const relPath = path.relative(repoRoot, filePath);
    console.log(`File: ${relPath}`);
  }
  if (prevLine) console.log(`\nPrev: ${prevLine}`);
  console.log(`Line: ${currLine}`);
  // Truncate suggestions to 10; offer the ignore/skip actions as the first options.
  const choices = [
    "*ignore*",
    "*ignore forever*",
    "*ignore file*",
    "*ignore directory*",
    "*skip repo*",
    ...suggestions.slice(0, 10),
  ];
  const prompt = new Select({
    name: "correction",
    message: `Choose a correction for "${word}":`,
    choices,
  });
  const answer = await prompt.run();
  if (answer === "*ignore*") {
    addTempIgnoredWord(word);
    return word;
  }
  if (answer === "*ignore forever*") {
    addIgnoredWord(word);
    console.log(`Added '${word}' to ignore forever list.`);
    return word;
  }
  if (answer === "*ignore file*") {
    throw new IgnoreFileError();
  }
  if (answer === "*ignore directory*") {
    if (filePath) {
      const repoRoot = process.cwd();
      const dir = path.relative(repoRoot, path.dirname(filePath));
      addIgnoredDir(dir);
      console.log(`Added directory '${dir}' to ignore list.`);
    }
    throw new IgnoreDirectoryError();
  }
  if (answer === "*skip repo*") {
    throw new SkipRepoError();
  }
  return answer;
}

export async function correctSpelling(
  text: string,
  filePath: string,
  opts: CorrectOptions = {}
): Promise<string> {
  const { autoYes = false, onCorrection } = opts;
  // Check if this file's directory is ignored
  const repoRoot = process.cwd();
  const dir = path.relative(repoRoot, path.dirname(filePath));
  const ignoredDirs = getIgnoredDirs();
  if (ignoredDirs.has(dir)) {
    // Skip this file
    return text;
  }
  let ignored = getIgnoredWords();
  let tempIgnored = getTempIgnoredWords();
  const lines = text.split(/\r?\n/);
  let inFencedBlock = false;
  let fencedBlockDelimiter: string | undefined = "";
  try {
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx] ?? "";
      // Detect start/end of fenced code block (``` or ~~~)
      const fenceMatch = line.match(/^([`~]{3,})(.*)$/);
      if (fenceMatch) {
        const delimiter = fenceMatch[1];
        if (!inFencedBlock) {
          inFencedBlock = true;
          fencedBlockDelimiter = delimiter;
        } else if (delimiter === fencedBlockDelimiter) {
          inFencedBlock = false;
          fencedBlockDelimiter = "";
        }
        // Always preserve the fence line itself
        lines[lineIdx] = line;
        continue;
      }
      if (inFencedBlock) {
        // Preserve lines inside fenced code blocks
        lines[lineIdx] = line;
        continue;
      }
      // For lines outside code blocks, preserve inline code and only spellcheck non-inline-code regions
      let result = "";
      const inlineCodeRegex = /`([^`]+)`/g;
      let match;
      let segments = [];
      let segmentStart = 0;
      while ((match = inlineCodeRegex.exec(line)) !== null) {
        // Non-inline-code segment before this inline code
        if (match.index > segmentStart) {
          segments.push({
            text: line.slice(segmentStart, match.index),
            isCode: false,
          });
        }
        // Inline code segment
        segments.push({ text: match[0], isCode: true });
        segmentStart = match.index + match[0].length;
      }
      // Remainder after last inline code
      if (segmentStart < line.length) {
        segments.push({ text: line.slice(segmentStart), isCode: false });
      }
      // Process each segment
      for (const seg of segments) {
        if (seg.isCode) {
          result += seg.text;
        } else {
          // Skip spellchecking for segments that are just URLs or emails
          if (EMAIL_REGEX.test(seg.text) || URL_REGEX.test(seg.text)) {
            result += seg.text;
            continue;
          }
          // Let cspell tokenize the fragment (it handles camelCase, code
          // terms, and numbers itself) and replace each misspelling in place.
          // Issues are ordered by offset, so we splice from a moving cursor.
          const issues = await findMisspellings(seg.text);
          let cursor = 0;
          for (const issue of issues) {
            const lower = issue.word.toLowerCase();
            if (ignored.has(lower) || tempIgnored.has(lower)) continue;
            if (issue.suggestions.length === 0) continue;
            const prevLine = lineIdx > 0 ? lines[lineIdx - 1] ?? "" : "";
            const replacement = await promptForCorrection(
              issue.word,
              issue.suggestions,
              prevLine,
              line,
              filePath,
              autoYes
            );
            ignored = getIgnoredWords();
            tempIgnored = getTempIgnoredWords();
            if (replacement !== issue.word) {
              result += seg.text.slice(cursor, issue.offset) + replacement;
              cursor = issue.offset + issue.length;
              onCorrection?.({
                file: filePath,
                from: issue.word,
                to: replacement,
              });
            }
          }
          // Append whatever follows the last applied correction.
          result += seg.text.slice(cursor);
        }
      }
      lines[lineIdx] = result as string;
    }
  } catch (err) {
    if (err instanceof IgnoreDirectoryError || err instanceof IgnoreFileError) {
      // Skip the rest of this file
      return lines.join("\n");
    }
    throw err;
  }
  return lines.join("\n");
}
