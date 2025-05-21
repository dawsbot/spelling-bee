import { cloneRepo } from "./clone-repo";

(async () => {
  try {
    const result = await cloneRepo({ owner: "vercel", repo: "next.js" });
    console.log("Cloned to:", result.dir, "Branch:", result.branch);
  } catch (e) {
    console.error("Error cloning repo:", e);
    process.exit(1);
  }
})();
