import { resolveRepo } from "./resolve-repo";

(async () => {
  try {
    const repo = await resolveRepo("https://github.com/JeanMeijer/analog");
    console.log("Repository metadata:", repo);
  } catch (err) {
    console.error("Error resolving repository:", err);
    process.exit(1);
  }
})();
