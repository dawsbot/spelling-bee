import { fetchTrendingRepos } from "./fetch-trending-repos";

(async () => {
  try {
    const repos = await fetchTrendingRepos();
    console.log("Trending repositories:");
    for (const repo of repos) {
      console.log(
        `- ${repo.owner}/${repo.name} (${repo.stars}⭐): ${repo.url}`
      );
    }
  } catch (err) {
    console.error("Error fetching trending repos:", err);
    process.exit(1);
  }
})();
