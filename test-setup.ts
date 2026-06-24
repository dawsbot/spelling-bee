import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Run the whole test suite against a throwaway config store so tests never read
// or mutate the developer's real ignore lists / seen-repo cache. Loaded via
// bunfig.toml's [test] preload, before any module reads this variable.
process.env.SPELLING_BEE_CONFIG_DIR ??= mkdtempSync(
  join(tmpdir(), "spelling-bee-test-")
);
