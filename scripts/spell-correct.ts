const nspell = require("nspell");
const { Select } = require("enquirer");
import Conf from "conf";
const path = require("path");

let spellPromise: Promise<any> | null = null;
const conf = new Conf<{ ignoredWords: string[]; ignoredDirectories: string[] }>(
  {
    projectName: "spelling-bee-js",
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

async function getSpell(): Promise<any> {
  if (spellPromise) return spellPromise;
  spellPromise = (async () => {
    // Read the .aff and .dic files directly from node_modules
    const affPath = "node_modules/dictionary-en/index.aff";
    const dicPath = "node_modules/dictionary-en/index.dic";
    const aff = await Bun.file(affPath).text();
    const dic = await Bun.file(dicPath).text();
    return nspell(aff, dic);
  })();
  return spellPromise;
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
  // Truncate suggestions to 10, add '*ignore*', '*ignore forever*', '*ignore file*', and '*ignore directory*' as the first options
  const choices = [
    "*ignore*",
    "*ignore forever*",
    "*ignore file*",
    "*ignore directory*",
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
  const spell = await getSpell();
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
      let lastIdx = 0;
      const inlineCodeRegex = /`([^`]+)`/g;
      let match;
      let processedLine = line;
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
          const words: string[] = seg.text.split(/(\b\w+\b)/g) as string[];
          for (let i = 0; i < words.length; i++) {
            const word = words[i] as string;
            if (!word) continue;
            // Skip emails, URLs, and numbers as words
            if (EMAIL_REGEX.test(word) || URL_REGEX.test(word)) continue;
            if (/^\d+(\.\d+)?$/.test(word)) continue; // Ignore numbers (integer or decimal)
            // Strip common Markdown formatting from start/end
            const stripped = word.replace(
              /^[*_~`\[\]()<>#>!.,:;'\"]+|[*_~`\[\]()<>#>!.,:;'\"]+$/g,
              ""
            );
            if (!stripped) continue;
            if (ignored.has(stripped.toLowerCase())) continue;
            if (tempIgnored.has(stripped.toLowerCase())) continue;
            if (/^\w+$/.test(stripped) && !spell.correct(stripped)) {
              const suggestions = spell.suggest(stripped);
              if (suggestions.length > 0) {
                const prevLine = lineIdx > 0 ? lines[lineIdx - 1] ?? "" : "";
                const replacement = await promptForCorrection(
                  stripped,
                  suggestions,
                  prevLine,
                  line,
                  filePath,
                  autoYes
                );
                // Replace only the misspelled token within the word slot,
                // preserving any surrounding markdown punctuation.
                if (replacement !== stripped) {
                  words[i] = (word as string).replace(stripped, replacement);
                  onCorrection?.({ file: filePath, from: stripped, to: replacement });
                }
                ignored = getIgnoredWords();
                tempIgnored = getTempIgnoredWords();
              }
            }
          }
          result += words.map((w) => w ?? "").join("");
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
