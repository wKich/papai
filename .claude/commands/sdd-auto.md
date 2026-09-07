---
description: Run the autonomous SDD pipeline on a task file
---

Run the autonomous spec-driven development pipeline:

```
bun run afk-runner:start -- start $ARGUMENTS
```

Pass a task file path and the optional `--depth S|M|L` flag (skip scope estimation) or the `--execute` flag (arm the run to execute its approved tasks.md through implement/verify/release). When the run parks at a gate, the command exits with a pointer to the gate file — attend it with `resume <runId>` after answering.

## Launch configuration

Every verb resolves its launch configuration through one ladder before any run work starts: a config file, else the environment, else the compiled defaults.

- **File** — `.afk-runner/config.json` at the repo root. Five keys: `repoRoot`, `workDir`, `model`, `budget`, `deadline`. A present file is wholesale-authoritative: its keys govern the whole launch and the environment entry is not consulted — only file absence falls to the next rung. `budget: null` launches unmetered. The optional `metered` boolean overrides the derivation — an explicit value beats the `budget !== null` default in both directions: `metered: false` with a numeric `budget` launches unmetered, `metered: true` with `budget: null` launches metered. `deadline` is minutes and arms the resume waiter at a gate.
- **Environment** — the `AFK_RUNNER_MODEL` entry names the model; no other entry is read.
- **Defaults** — model `opencode`, budget `5` (USD), work dir `.afk-runner`; no deadline.

The config file is untracked by design: `.afk-runner/` is git-ignored, so the launch configuration is per-checkout and does not round-trip through a clone. Configuration rides the file-over-environment-over-defaults ladder — there are no command-line flags for model, budget, or deadline.
