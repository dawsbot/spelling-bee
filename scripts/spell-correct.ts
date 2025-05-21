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

class IgnoreDirectoryError extends Error {
  constructor() {
    super("Ignore this directory");
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
  filePath?: string
): Promise<string> {
  // Print context
  if (filePath) {
    // Print file path relative to repo root
    const repoRoot = process.cwd();
    const relPath = path.relative(repoRoot, filePath);
    console.log(`File: ${relPath}`);
  }
  if (prevLine) console.log(`\nPrev: ${prevLine}`);
  console.log(`Line: ${currLine}`);
  // Truncate suggestions to 10, add '*ignore*', '*ignore forever*', and '*ignore directory*' as the first options
  const choices = [
    "*ignore*",
    "*ignore forever*",
    "*ignore directory*",
    ...suggestions.slice(0, 10),
  ];
  const prompt = new Select({
    name: "correction",
    message: `Choose a correction for "${word}":`,
    choices,
  });
  const answer = await prompt.run();
  if (answer === "*ignore*") return word;
  if (answer === "*ignore forever*") {
    addIgnoredWord(word);
    console.log(`Added '${word}' to ignore forever list.`);
    return word;
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
  filePath?: string
): Promise<string> {
  // Check if this file's directory is ignored
  if (filePath) {
    const repoRoot = process.cwd();
    const dir = path.relative(repoRoot, path.dirname(filePath));
    const ignoredDirs = getIgnoredDirs();
    if (ignoredDirs.has(dir)) {
      // Skip this file
      return text;
    }
  }
  const spell = await getSpell();
  let ignored = getIgnoredWords();
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
            if (/^\w+$/.test(stripped) && !spell.correct(stripped)) {
              const suggestions = spell.suggest(stripped);
              if (suggestions.length > 0) {
                const prevLine = lineIdx > 0 ? lines[lineIdx - 1] ?? "" : "";
                words[i] = await promptForCorrection(
                  stripped,
                  suggestions,
                  prevLine,
                  line,
                  filePath
                );
                ignored = getIgnoredWords();
              }
            }
          }
          result += words.map((w) => w ?? "").join("");
        }
      }
      lines[lineIdx] = result as string;
    }
  } catch (err) {
    if (err instanceof IgnoreDirectoryError) {
      // Skip the rest of this file
      return lines.join("\n");
    }
    throw err;
  }
  return lines.join("\n");
}
