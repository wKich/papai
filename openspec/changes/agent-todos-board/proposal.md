# agent-todos-board — Proposal

## Why

Change A (`agent-todos-capture`) puts stage agents' todo lists into the run log as L0 `agent_todos` events, but nothing reads them: the board's run detail shows agent activity at tool granularity and the walk's task record, yet never what a running agent is doing inside its current step. On a phone, that is exactly the question — "is the implementer writing the test or lost in the handler?" — that decides whether to wait or steer.

## What Changes

- Run detail gains an **agent todos panel**: per agent label, its latest todo list with item statuses, read from the log's `agent_todos` events (last snapshot per agent wins; historical runs render too).
- The detail view becomes **live**: while a run's detail is open, an incoming SSE snapshot re-fetches the detail for the selected run (throttled), instead of today's fetch-once behavior (index.html fetches detail only on open).
- `agent_todos` events are **excluded from the recent-events feed** — they have a dedicated panel; without the filter, a walk with ten agents would crowd the bounded feed with checkbox churn.
- The panel is **labeled as agent-authored**: todo items are the agent's own scratchpad and are visually distinct from the runner's walk task record (which stays the truth surface for run progress).

## Capabilities

### New Capabilities

- `afk-runner-board-todos`: the board's read-only rendering of agent todo telemetry. Without it the captured events are write-only — no human surface can answer "what is the agent doing right now" or "what did it plan". The existing board capability (`afk-runner-web-board`) covers card/detail/gate rendering but has no todo surface; this extends the board's detail projection rather than replacing it.

### Modified Capabilities

(none — the board's capability spec is not yet in `openspec/specs/`: `afk-runner-web-board` is complete but unarchived, so there is no main spec to delta against. The detail-liveness fix this change requires is admitted here, in this capability's spec, rather than as a board-spec modification — live todos are its forcing consumer, and the fix generalizes to every detail field.)

## Non-goals

- Portfolio cards carrying todo state — the full-snapshot-per-change SSE doctrine multiplies any card payload by run count; detail is the supervision surface, the card already carries the walk line. Declined.
- Any action over todos — no settle, steer, edit, or acknowledge; the board stays read-only.
- Deriving todos from `transcripts/*.jsonl` or agent session storage — the log is the board's only input.
- Rendering historical todo *trajectories* (full event history) — last snapshot per agent only; the log keeps the trajectory for later readers if wanted.

## Impact

- `afk-runner/src/serve/run-detail.ts` (projection: todos field, feed filter), `static/index.html` (panel + detail re-fetch on snapshot; not mutation-gateable, covered by projection tests behind it).
- Depends on `agent-todos-capture` for the event type; renders nothing for runs without `agent_todos` events (no error, no empty panel noise).
- Docs: `docs/architecture/afk-runner.md` web-board section.
