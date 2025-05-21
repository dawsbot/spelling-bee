import { findTextFiles } from "./find-text-files";

(async () => {
  try {
    const files = await findTextFiles("./");
    console.log("Text files found:");
    for (const file of files) {
      console.log(file);
    }
  } catch (err) {
    console.error("Error finding text files:", err);
    process.exit(1);
  }
})();
