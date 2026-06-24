import { readdir } from "fs/promises";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import ignore from "ignore";

const TEXT_FILE_EXTENSIONS = [".md", ".txt", ".rtf"];

// ISO 639-1 language codes. We use these to skip translated docs such as
// README.de.md or README.zh-CN.md: our spellchecker is English-only, so a
// foreign-language file is nothing but false positives.
const LANGUAGE_CODES = new Set(
  (
    "aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce " +
    "ch co cr cs cu cv cy da de dv dz ee el eo es et eu fa ff fi fj fo fr fy " +
    "ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it " +
    "iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo " +
    "lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny " +
    "oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl " +
    "sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty " +
    "ug uk ur uz ve vi vo wa wo xh yi yo za zh zu"
  ).split(" ")
);

function isTextFile(filename: string): boolean {
  return TEXT_FILE_EXTENSIONS.some((ext) =>
    filename.toLowerCase().endsWith(ext)
  );
}

/**
 * True for translated docs tagged with a non-English language, e.g.
 * `README.ar.md`, `README.pt-BR.md`, `README.zh-CN.md`. Plain `README.md` and
 * English-tagged files (`README.en.md`) are kept since we can spellcheck them.
 */
function isForeignLanguageFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  const ext = TEXT_FILE_EXTENSIONS.find((e) => lower.endsWith(e));
  if (!ext) return false;
  const base = lower.slice(0, -ext.length); // "readme.pt-br"
  const dot = base.lastIndexOf(".");
  if (dot === -1) return false; // no language tag, e.g. "readme"
  const primary = base.slice(dot + 1).split(/[-_]/)[0] ?? ""; // "pt-br" -> "pt"
  if (primary === "en") return false; // English is in-scope
  return LANGUAGE_CODES.has(primary);
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
        if (isForeignLanguageFile(entry.name)) continue;
        results.push(fullPath);
      }
    }
  }

  await scan(rootDir);
  return results;
}
