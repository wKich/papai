---
description: Run the autonomous SDD pipeline on a task file
---

Run the autonomous spec-driven development pipeline:

```
bun run afk-runner:start -- start $ARGUMENTS
```

Pass a task file path and the optional `--depth S|M|L` flag (skip scope estimation) or the `--execute` flag (arm the run to execute its approved tasks.md through implement/verify/release). When the run parks at a gate, the command exits with a pointer to the gate file — attend it with `resume <runId>` after answering.
