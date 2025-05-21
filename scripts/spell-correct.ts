const nspell = require("nspell");
const { Select } = require("enquirer");
import Conf from "conf";

let spellPromise: Promise<any> | null = null;
const conf = new Conf<{ ignoredWords: string[] }>({
  projectName: "spelling-bee-js",
});
const IGNORED_KEY = "ignoredWords";

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
  currLine: string
): Promise<string> {
  // Print context
  if (prevLine) console.log(`\nPrev: ${prevLine}`);
  console.log(`Line: ${currLine}`);
  // Truncate suggestions to 10, add '*ignore*' and '*ignore forever*' as the first options
  const choices = ["*ignore*", "*ignore forever*", ...suggestions.slice(0, 10)];
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
  return answer;
}

export async function correctSpelling(text: string): Promise<string> {
  const spell = await getSpell();
  let ignored = getIgnoredWords();
  const lines = text.split(/\r?\n/);
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx] ?? "";
    // Skip spellchecking for lines that are just URLs or emails
    if (EMAIL_REGEX.test(line) || URL_REGEX.test(line)) {
      lines[lineIdx] = line;
      continue;
    }
    const words = line.split(/(\b\w+\b)/g);
    for (let i = 0; i < words.length; i++) {
      const word = words[i] ?? "";
      // Skip emails, URLs, and numbers as words
      if (EMAIL_REGEX.test(word) || URL_REGEX.test(word)) continue;
      if (/^\d+(\.\d+)?$/.test(word)) continue; // Ignore numbers (integer or decimal)
      // Strip common Markdown formatting from start/end
      const stripped = word.replace(
        /^[*_~`\[\]()<>#>!.,:;'"]+|[*_~`\[\]()<>#>!.,:;'"]+$/g,
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
            line
          );
          ignored = getIgnoredWords();
        }
      }
    }
    lines[lineIdx] = words.map((w) => w ?? "").join("");
  }
  return lines.join("\n");
}
