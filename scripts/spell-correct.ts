const nspell = require("nspell");
const { Select } = require("enquirer");

let spellPromise: Promise<any> | null = null;

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
  // Truncate suggestions to 10, add '*ignore*' as the first option
  const choices = ["*ignore*", ...suggestions.slice(0, 10)];
  const prompt = new Select({
    name: "correction",
    message: `Choose a correction for "${word}":`,
    choices,
  });
  const answer = await prompt.run();
  return answer === "*ignore*" ? word : answer;
}

export async function correctSpelling(text: string): Promise<string> {
  const spell = await getSpell();
  const lines = text.split(/\r?\n/);
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx] ?? "";
    const words = line.split(/(\b\w+\b)/g);
    for (let i = 0; i < words.length; i++) {
      const word = words[i] ?? "";
      if (/^\w+$/.test(word) && !spell.correct(word)) {
        const suggestions = spell.suggest(word);
        if (suggestions.length > 0) {
          const prevLine = lineIdx > 0 ? lines[lineIdx - 1] ?? "" : "";
          words[i] = await promptForCorrection(
            word,
            suggestions,
            prevLine,
            line
          );
        }
      }
    }
    lines[lineIdx] = words.map((w) => w ?? "").join("");
  }
  return lines.join("\n");
}
