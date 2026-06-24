# spelling-bee-js

A [Bun](https://bun.sh) CLI that finds and fixes spelling mistakes in GitHub
repositories and opens pull requests with the corrections. Point it at a single
repo or let it sweep trending repositories automatically.

It scans `.md`, `.markdown`, `.txt`, `.text`, and `.rst` files (skipping
translated docs like `README.de.md`, since the checker is English-only), is
format-aware (skips fenced and inline code, URLs, and emails), and lets you
ignore words, files, directories, or the whole repo during interactive review.
Any repository it has already processed (a PR opened, no fixes found, or
skipped) is remembered locally and skipped before cloning on future runs.

## Setup

```bash
bun install
```

Authentication prefers the GitHub CLI. If you're logged in, nothing else is
needed:

```bash
gh auth login
```

Alternatively (or as a fallback), set a `GITHUB_TOKEN` in a `.env` file. The
token needs the `repo` scope to fork and open PRs, and `delete_repo` for the
fork cleanup feature.

```
GITHUB_TOKEN=ghp_your_token_here
```

## Usage

Fix a single repository (interactive review of each suggested correction):

```bash
bun run index.ts owner/repo
# or a full URL
bun run index.ts https://github.com/owner/repo
```

Sweep trending repositories non-interactively, auto-applying the top suggestion:

```bash
bun run index.ts --trending --limit 5 --yes
```

Preview changes without forking or opening a PR:

```bash
bun run index.ts owner/repo --dry-run
```

Delete forks for PRs that have since been merged or closed:

```bash
bun run index.ts --cleanup
```

### Options

| Flag         | Description                                            |
| ------------ | ------------------------------------------------------ |
| `--yes`      | Non-interactive: auto-apply the top spelling suggestion |
| `--dry-run`  | Show what would change without forking or opening a PR |
| `--limit N`  | Number of trending repos to process (with `--trending`) |
| `--cleanup`  | Delete forks for merged/closed PRs                     |
| `--help`     | Show help                                              |

## How it works

1. Resolve the target repo(s) via the GitHub API.
2. Shallow-clone each repo into a unique `/tmp/spelling-bee-*` directory.
3. Detect and correct spelling in supported text files.
4. If anything changed, fork the repo, push a branch, and open a PR.
5. Clean up the temp directory, and (via `--cleanup`) delete the fork once the
   PR is merged or closed.

## Development

```bash
bun test          # run the test suite
bun run typecheck # type-check with tsgo
```
