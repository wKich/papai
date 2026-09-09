<!-- SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details. -->

# Evidence notes — afk-runner-service

## Phase 0 — gate attendance over the retained corpus (2026-09-09)

Command (read-only, exit 0), the five retained workdirs (the U13 substrate —
2 C9 + 3 C8 workdirs, 9 runs, 0 era-contaminated):

```
bun afk-runner/src/cli.ts analyze \
  ~/Projects/yourpapai/u3-live-proof-target-p/.sdd-runner \
  ~/Projects/yourpapai/u3-live-proof-target-u/.sdd-runner \
  ~/Projects/yourpapai/papai/.worktrees/v2-live-proof-target-a/.sdd-runner \
  ~/Projects/yourpapai/papai/.worktrees/v2-live-proof-target-b/.sdd-runner \
  ~/Projects/yourpapai/papai/.worktrees/v2-live-proof-target-c/.sdd-runner \
  --json
```

Aggregate (`aggregates.gateAttendance`):

| fact                    | value                                        |
| ----------------------- | -------------------------------------------- |
| answered gates          | 29                                           |
| human-settled           | 26 (rate **0.897**)                          |
| policy-settled          | 3 (all presentation-time prelude, ~0m waits) |
| waiter-settled          | 0                                            |
| never-answered pending  | 0 (beside the rate, per the spec)            |
| unknown / reduced cover | 0                                            |
| human-wait median       | 748,807 ms (~12.5m)                          |
| human-wait upper bound  | 35,719,321 ms (~595m ≈ 9.9h)                 |

Per-run shape: the two C8 matrix runs carry 8 and 12 human-settled gates with
waits from 2m to 595m (the long tail is the overnight-parked pair 329m/595m);
the scratch/short runs contribute 1–2 gates each at 1m–13m; the three
`count-killed-turns` policy settles are R-rule prelude records with ~0m waits.

### Promote/demote reading for the Phase 3 settle plane (design D6)

- **Promote.** 89.7% of answered gates were settled by a human and the median
  human wait is ~12.5 minutes — supervision demand is real, recurrent, and the
  waits are operator-visible wall time. Under design D6's rule ("high
  human-settle rate → settle plane early"), the settle delegation half of the
  bridge earns the first slot when Phase 3 is proposed.
- The waiter settled nothing in this corpus — the deadline ladder absorbed
  what it could before presentation, so remote settle would not be competing
  with automation; it replaces the human channel for the 89.7%.
- Caveats per the design's risk row: this measures the past, n=9 runs from 3
  cycles, one operator, and the corpus's gates skew toward the C8 matrix's
  attended drills. Pricing input, not proof; the metric re-runs cheaply
  (`analyze --json`) on every future corpus, and the numbers land in this
  section each time.

## Phase 1 — central-store dogfood

### WorkDir ⊆ repoRoot audit (task 2.2, 2026-09-09)

Swept every path construction in `afk-runner/src/` for an assumption that
bookkeeping sits under the repo root. **Zero defects found.**

- Bookkeeping paths all flow from the resolved config —
  `path.join(workDir, 'runs', …)` in `run.ts`, `run-state.ts`, `run-index.ts`,
  `run-stop.ts`, `run-resume.ts`, `run-lite.ts`, `accounting.ts`,
  `work/report.ts`, `serve/load.ts`, `serve/sweep.ts`, `analyze-io.ts`, `cli.ts`
  — and runDir-derived joins (`gate-waiter.ts`, `stop-controller.ts`,
  `session-ledger.ts`, `drive/loop.ts` `dirname(logPath)`) inherit the same
  root. No verb re-derives workDir from repoRoot.
- `config.ts:141` resolves `workDir` via `path.resolve(repoRoot, workDir)` —
  an absolute value wins; pinned as contract by the new `config.test.ts`
  cases (task 2.1), including "nothing under `<repoRoot>/.afk-runner/` beyond
  the config" and "the store's own config.json is never a launch surface".
- Near-finding examined and cleared: `work/gate-prelude.ts:96` computes
  `path.relative(repoRoot, runDir)` for the R3 assumption-boundary join. With a
  relocated store this yields a `../`-prefixed string, but the join is
  transform-consistent — the artifact-event paths it is compared against are
  recorded through the same `path.relative(repoRoot, …)` (`work/materialize.ts`)
  — and any mismatch classifies fail-closed (high-blast), never vacuously
  low-blast. Not a defect.
- The write guard (`write-guard.ts`) judges git-dirty repo paths; a store
  outside the repo never appears in `git status`, so guard semantics are
  unchanged by relocation.
- The memo already persists `repoRoot` (`run.ts` `seedRepoState`) — the field
  the shared-store spec needs to attribute runs to worktrees.
- Agent scratch/report paths (`agent-layer.ts` → `agentWritePath`) resolve
  against the agent's cwd, not the run dir — unaffected.

Verification: `bun run typecheck` clean; `bun test tests/afk-runner/` green.

### Dogfood record (tasks 3.1–3.3)

(to be recorded)
