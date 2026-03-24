# Multi-Agent TDD Hooks: Claude Code + OpenCode Compatibility Plan

> **Companion to:** `2026-03-23-tdd-hooks-integration.md` (Claude Code–only plan)
>
> **Goal:** Make TDD enforcement hooks work with both Claude Code and OpenCode through
> shared core logic and platform-specific thin adapters.

---

## Research Summary

### OpenCode Plugin System (v1.2.27+)

| Aspect           | Details                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| Architecture     | JS/TS modules exporting async plugin functions — NOT shell commands      |
| Plugin location  | `.opencode/plugins/` (project) or `~/.config/opencode/plugins/` (global) |
| Auto-loading     | All `.js`/`.ts` files in plugin dirs loaded at startup                   |
| TypeScript types | `import type { Plugin } from "@opencode-ai/plugin"`                      |
| Runtime          | In-process Bun (not subprocess)                                          |
| Plugin context   | `{ project, client, $, directory, worktree, serverUrl }`                 |
| npm plugins      | Declared in `opencode.json` `"plugin"` array; auto-installed via Bun     |
| Dependencies     | `.opencode/package.json` → `bun install` at startup                      |

### OpenCode Hook Events (relevant to TDD)

| Hook                                 | Signature                     | Analogous to (Claude Code) |
| ------------------------------------ | ----------------------------- | -------------------------- |
| `tool.execute.before`                | `async (input, output) => {}` | `PreToolUse`               |
| `tool.execute.after`                 | `async (input, output) => {}` | `PostToolUse`              |
| `tool.execute.error`                 | `async (input, output) => {}` | _(no equivalent)_          |
| `event` (with `session.idle`)        | `async ({ event }) => {}`     | `Stop` (partial)           |
| `experimental.chat.system.transform` | `async (input, output) => {}` | _(no equivalent)_          |

### OpenCode Hook Input/Output Types

**`tool.execute.before`:**

```typescript
input: {
  tool: string
  sessionID: string
  callID: string
}
output: {
  args: Record<string, any>
} // MUTABLE — can modify tool arguments
// Blocking: throw new Error("message") → prevents tool execution, error visible to LLM
```

**`tool.execute.after`:**

```typescript
input: {
  tool: string
  sessionID: string
  callID: string
  args: Record<string, any>
}
output: {
  title: string
  metadata: any
  output: string
} // bash tools
// OR { content: string; isError: boolean }           // other tools
// CANNOT block — tool already executed
// CANNOT inject AI-visible messages (GitHub issue #17412 — requested feature)
```

**`tool.execute.error`:**

```typescript
input: { tool: string; sessionID: string; callID: string; args: any }
output: { error: Error; result?: { title: string; output: string; metadata: any } }
// Can modify error or provide fallback result
```

### OpenCode Tool Names

| Claude Code       | OpenCode    | Notes           |
| ----------------- | ----------- | --------------- |
| `Write`           | `write`     | Lowercase       |
| `Edit`            | `edit`      | Lowercase       |
| _(no equivalent)_ | `patch`     | Diff-based edit |
| _(no equivalent)_ | `multiedit` | Multi-file edit |
| `Bash`            | `bash`      | Lowercase       |
| `Read`            | `read`      | Lowercase       |

OpenCode's `edit` permission covers `edit`, `write`, `patch`, and `multiedit` tools.

---

## Platform Comparison: Claude Code vs OpenCode

| Aspect                   | Claude Code                                              | OpenCode                                                        |
| ------------------------ | -------------------------------------------------------- | --------------------------------------------------------------- |
| **Hook execution model** | Subprocess (shell command via `node`)                    | In-process function callback                                    |
| **Input delivery**       | JSON on stdin                                            | Function parameters `(input, output)`                           |
| **Output/blocking**      | JSON on stdout                                           | `throw Error()` or mutate `output`                              |
| **PreToolUse block**     | `{ hookSpecificOutput: { permissionDecision: "deny" } }` | `throw new Error("reason")`                                     |
| **PostToolUse block**    | `{ decision: "block", reason: "..." }`                   | **NOT POSSIBLE directly** (see §Workaround)                     |
| **Tool name format**     | PascalCase (`Write`, `Edit`)                             | lowercase (`write`, `edit`, `patch`, `multiedit`)               |
| **File path field**      | `tool_input.file_path`                                   | `output.args.filePath` (before) / `input.args.filePath` (after) |
| **Session ID**           | `session_id` (snake_case)                                | `sessionID` (camelCase)                                         |
| **Project root**         | `cwd` from input JSON                                    | `directory` from plugin context closure                         |
| **Registration**         | `.claude/settings.local.json` hooks config               | Auto-load from `.opencode/plugins/`                             |
| **Tool matchers**        | Regex pattern (`Write\|Edit`)                            | Manual `if (input.tool === ...)` check                          |
| **Hook isolation**       | Each hook = separate file + process                      | Single plugin file, multiple hook handlers                      |
| **Session state**        | File-based (`/tmp/tdd-session-*`)                        | In-memory Map + file (closure persists)                         |
| **Stop interception**    | `Stop` hook event                                        | **Not available** (issue #16626 — feature request)              |
| **AI message injection** | stdout JSON with `reason` field                          | **Not available** (issue #17412 — feature request)              |

---

## Per-Hook Feasibility Assessment

### 1. `enforce-tdd` (PreToolUse → `tool.execute.before`) ✅ FULLY COMPATIBLE

| Concern            | Resolution                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Blocking mechanism | `throw new Error()` — error message IS visible to the LLM                                                            |
| Tool matching      | `if (input.tool === "write" \|\| input.tool === "edit" \|\| input.tool === "patch" \|\| input.tool === "multiedit")` |
| File path access   | `output.args.filePath` (the `filePath` field name is used by OpenCode edit/write)                                    |
| Project root       | `directory` from plugin context closure                                                                              |
| Session state      | Read from shared state object (Map or file)                                                                          |

**Verdict:** Direct adaptation. `throw new Error(...)` message appears as the tool's error response, visible to the LLM — providing the same TDD guidance as Claude Code's `permissionDecisionReason`.

### 2. `enforce-tdd-tracker` (PostToolUse → `tool.execute.after`) ✅ FULLY COMPATIBLE

| Concern            | Resolution                                                                  |
| ------------------ | --------------------------------------------------------------------------- |
| Observing writes   | `input.tool === "write" \|\| input.tool === "edit"` in `tool.execute.after` |
| File path access   | `input.args.filePath`                                                       |
| State persistence  | Plugin closure Map keyed by `input.sessionID`                               |
| No blocking needed | This hook only records — no output needed                                   |

**Verdict:** Even simpler than Claude Code — in-memory Map in plugin closure eliminates file I/O.

### 3. `verify-tests-pass` (PostToolUse → `tool.execute.after`) ⚠️ REQUIRES WORKAROUND

**The problem:** OpenCode's `tool.execute.after` cannot block the agent or inject AI-visible messages. Claude Code's PostToolUse can return `{ decision: "block", reason: "..." }` which halts the agent with test failure output. OpenCode has no equivalent.

**Confirmed limitations:**

- GitHub issue #17412: "Plugin hooks should be able to inject AI-visible messages into conversation context" — **open, not resolved**
- GitHub issue #16626: "add session.stopping plugin hook to allow re-entering the agent loop" — **open, not resolved**

### Workaround: Deferred Blocking via `tool.execute.before`

Instead of blocking _after_ the edit that broke tests, block the _next_ tool call until tests pass:

```
1. tool.execute.after (edit/write):
   → Run `bun test` on related test file
   → If FAIL: store failure info in plugin state

2. tool.execute.before (ANY subsequent tool call):
   → Check plugin state for pending test failure
   → If found: throw new Error("Tests FAILED for {file}. Fix before proceeding:\n{output}")
   → The agent sees the error, fixes the test, and on the next tool call the state is re-checked

3. tool.execute.after (edit/write) again:
   → Re-run tests
   → If PASS: clear the pending failure state
```

**Trade-off:** The first broken edit goes through (tool already executed), but the agent is blocked from doing _anything else_ until tests pass. This is functionally equivalent to Claude Code's behavior since the agent must fix tests before proceeding.

---

## Recommended Architecture: Shared Core + Platform Adapters

```
project/
├── .hooks/                        # Shared core logic (platform-agnostic ES modules)
│   └── tdd/
│       ├── test-resolver.mjs      # Find test file for impl file
│       ├── session-state.mjs      # Session state interface (memory or file)
│       └── test-runner.mjs        # Execute bun test, parse results
│
├── .claude/                       # Claude Code adapter layer
│   ├── settings.local.json        # Hook registration
│   └── hooks/
│       ├── enforce-tdd.mjs        # PreToolUse → imports from .hooks/tdd/
│       ├── enforce-tdd-tracker.mjs # PostToolUse → imports from .hooks/tdd/
│       └── verify-tests-pass.mjs  # PostToolUse → imports from .hooks/tdd/
│
└── .opencode/                     # OpenCode adapter layer
    ├── package.json               # { "dependencies": { "@opencode-ai/plugin": "latest" } }
    └── plugins/
        └── tdd-enforcement.ts     # Single plugin: all hooks via .hooks/tdd/ imports
```

### Shared Core Modules

**`.hooks/tdd/test-resolver.mjs`** — Platform-agnostic test file resolution:

```javascript
// Inputs: implAbsPath, projectRoot
// Output: testAbsPath | null
// Logic: src/foo/bar.ts → tests/foo/bar.test.ts (with colocated fallback)
```

**`.hooks/tdd/session-state.mjs`** — State interface with two backends:

```javascript
// FileBackend: /tmp/tdd-session-{sessionId}.json (for Claude Code subprocess model)
// MemoryBackend: Map<string, State> (for OpenCode in-process model)
// Interface: getState(sessionId), addTestFile(sessionId, path), getPendingFailure(sessionId), etc.
```

**`.hooks/tdd/test-runner.mjs`** — Execute bun test and return structured result:

```javascript
// Input: testFilePath, projectRoot
// Output: { passed: boolean, output: string }
```

### Claude Code Adapters (thin wrappers)

Each `.claude/hooks/*.mjs` file:

1. Reads JSON from stdin
2. Extracts `{ tool_name, tool_input, session_id, cwd }`
3. Calls shared core function
4. Writes JSON to stdout (Claude Code protocol)

### OpenCode Adapter (single plugin)

`.opencode/plugins/tdd-enforcement.ts`:

1. Imports shared core modules
2. Captures `directory` from plugin context
3. Returns hook object with `tool.execute.before` and `tool.execute.after` handlers
4. Uses deferred-blocking pattern for test verification

---

## Detailed Task Breakdown

### Phase 1A: Extract shared core (prerequisite for multi-platform)

> This phase modifies the original plan's Tasks 1–3 to extract reusable logic
> before writing platform-specific adapters.

#### Task 1A.1: Create `.hooks/tdd/test-resolver.mjs`

**Extract from:** Task 1 (`enforce-tdd.mjs`) `findTestFile()` function + Task 3 (`verify-tests-pass.mjs`) `findTestFile()` function

**Interface:**

```javascript
/**
 * @param {string} implAbsPath - Absolute path to implementation file
 * @param {string} projectRoot - Project root directory
 * @returns {string|null} - Absolute path to test file, or null
 */
export function findTestFile(implAbsPath, projectRoot) { ... }

/**
 * @param {string} filePath - File path to check
 * @returns {boolean} - True if this is a test file
 */
export function isTestFile(filePath) { ... }

/**
 * @param {string} filePath - File path to check
 * @returns {boolean} - True if this is a gateable implementation file
 */
export function isGateableImplFile(filePath, projectRoot) { ... }

/**
 * @param {string} implRelPath - Relative path from projectRoot (e.g. src/foo/bar.ts)
 * @returns {string} - Suggested test file relative path (e.g. tests/foo/bar.test.ts)
 */
export function suggestTestPath(implRelPath) { ... }
```

**Acceptance criteria:**

- Pure functions, no I/O except `fs.existsSync` for `findTestFile`
- Handles `src/**/*.ts` → `tests/**/*.test.ts` mapping
- Handles colocated fallback
- Skips non-`src/` files and non-TS/JS files
- Unit testable with mock filesystem

**Estimate:** 2h ±0.5h

---

#### Task 1A.2: Create `.hooks/tdd/session-state.mjs`

**Interface:**

```javascript
/**
 * File-based backend (Claude Code — hooks run as subprocesses)
 */
export class FileSessionState {
  constructor(sessionId, stateDir = '/tmp') { ... }
  getWrittenTests() { ... }    // returns string[]
  addWrittenTest(path) { ... } // appends to list
  getPendingFailure() { ... }  // returns { file, output } | null
  setPendingFailure(file, output) { ... }
  clearPendingFailure() { ... }
}

/**
 * Memory-based backend (OpenCode — plugin runs in-process)
 */
export class MemorySessionState {
  // Same interface, backed by static Map
  static sessions = new Map()
  constructor(sessionId) { ... }
  getWrittenTests() { ... }
  addWrittenTest(path) { ... }
  getPendingFailure() { ... }
  setPendingFailure(file, output) { ... }
  clearPendingFailure() { ... }
}
```

**Acceptance criteria:**

- Both backends implement identical interface
- FileSessionState uses atomic write (write to tmp + rename)
- MemorySessionState keys by sessionId
- Handles missing/corrupt state files gracefully

**Estimate:** 2h ±0.5h

---

#### Task 1A.3: Create `.hooks/tdd/test-runner.mjs`

**Interface:**

```javascript
/**
 * @param {string} testFilePath - Absolute path to test file
 * @param {string} projectRoot - Project root for cwd
 * @returns {Promise<{ passed: boolean, output: string }>}
 */
export async function runTest(testFilePath, projectRoot) { ... }
```

**Implementation:**

- Spawns `bun test <file>` with 30s timeout
- Captures stdout + stderr
- Returns `{ passed, output }` (output truncated to 3000 chars)
- Handles timeout gracefully (returns `{ passed: false, output: "Test timed out" }`)

**Estimate:** 1.5h ±0.5h

---

### Phase 1B: Update Claude Code adapters (modify original Tasks 1–3)

The original plan's Task 1–3 hooks become thin adapters that import from `.hooks/tdd/`:

#### Task 1B.1: Rewrite `enforce-tdd.mjs` as adapter

```javascript
#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { findTestFile, isTestFile, isGateableImplFile, suggestTestPath } from '../../.hooks/tdd/test-resolver.mjs'
import { FileSessionState } from '../../.hooks/tdd/session-state.mjs'

const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
const { tool_name, tool_input, session_id, cwd } = input

if (tool_name !== 'Write' && tool_name !== 'Edit') process.exit(0)

const filePath = tool_input.file_path
if (!filePath) process.exit(0)
if (isTestFile(filePath)) process.exit(0)
if (!isGateableImplFile(filePath, cwd)) process.exit(0)

const absPath = path.resolve(filePath)
const state = new FileSessionState(session_id)

if (findTestFile(absPath, cwd)) process.exit(0)

const writtenTests = state.getWrittenTests()
const baseName = path.basename(absPath, path.extname(absPath))
const alreadyTestedThisSession = writtenTests.some(
  (t) => path.basename(t, path.extname(t)).replace(/\.(test|spec)$/, '') === baseName,
)
if (alreadyTestedThisSession) process.exit(0)

const relPath = path.relative(cwd, filePath)
const suggestedTest = suggestTestPath(relPath)

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `TDD violation: No test file found for \`${relPath}\`.\n\n` +
        `Write a failing test first:\n  → ${suggestedTest}\n\n` +
        `Then re-attempt writing the implementation.`,
    },
  }),
)
```

**Estimate:** 1h ±0.5h (refactor from original, most logic now in shared modules)

---

#### Task 1B.2: Rewrite `enforce-tdd-tracker.mjs` as adapter

Thin adapter: read stdin, call `state.addWrittenTest()`.

**Estimate:** 0.5h

---

#### Task 1B.3: Rewrite `verify-tests-pass.mjs` as adapter

Adapter: read stdin, call `runTest()`, output block JSON if failed.

**Estimate:** 1h ±0.5h

---

### Phase 1C: Create OpenCode plugin

#### Task 1C.1: Create `.opencode/plugins/tdd-enforcement.ts`

Single plugin file implementing all three TDD hooks:

```typescript
import type { Plugin } from '@opencode-ai/plugin'
import { findTestFile, isTestFile, isGateableImplFile, suggestTestPath } from '../../.hooks/tdd/test-resolver.mjs'
import { MemorySessionState } from '../../.hooks/tdd/session-state.mjs'
import { runTest } from '../../.hooks/tdd/test-runner.mjs'
import path from 'node:path'

// OpenCode edit tools (lowercase + additional tools not in Claude Code)
const EDIT_TOOLS = new Set(['write', 'edit', 'patch', 'multiedit'])

export const TddEnforcement: Plugin = async ({ directory }) => {
  return {
    // ─── enforce-tdd (PreToolUse equivalent) ───
    // Also handles deferred test-failure blocking
    'tool.execute.before': async (input, output) => {
      const state = new MemorySessionState(input.sessionID)

      // DEFERRED BLOCKING: If previous edit broke tests, block ALL tools until fixed
      const pending = state.getPendingFailure()
      if (pending) {
        throw new Error(
          `Tests are RED after your edit of \`${pending.file}\`.\n\n` +
            `You must fix the failing tests before proceeding.\n\n` +
            `── Test output ──────────────────────────────\n` +
            `${pending.output}\n` +
            `─────────────────────────────────────────────\n\n` +
            `Fix the regression, then re-attempt.`,
        )
      }

      // TDD GATE: Block impl writes without test
      if (!EDIT_TOOLS.has(input.tool)) return

      const filePath = output.args.filePath as string
      if (!filePath) return
      if (isTestFile(filePath)) return
      if (!isGateableImplFile(filePath, directory)) return

      const absPath = path.resolve(directory, filePath)
      if (findTestFile(absPath, directory)) return

      const writtenTests = state.getWrittenTests()
      const baseName = path.basename(absPath, path.extname(absPath))
      const alreadyTestedThisSession = writtenTests.some(
        (t) => path.basename(t, path.extname(t)).replace(/\.(test|spec)$/, '') === baseName,
      )
      if (alreadyTestedThisSession) return

      const relPath = path.relative(directory, filePath)
      const suggestedTest = suggestTestPath(relPath)

      throw new Error(
        `TDD violation: No test file found for \`${relPath}\`.\n\n` +
          `Write a failing test first:\n  → ${suggestedTest}\n\n` +
          `Then re-attempt writing the implementation.`,
      )
    },

    // ─── enforce-tdd-tracker + verify-tests-pass (PostToolUse equivalent) ───
    'tool.execute.after': async (input) => {
      if (!EDIT_TOOLS.has(input.tool)) return

      const filePath = input.args.filePath as string
      if (!filePath) return

      const state = new MemorySessionState(input.sessionID)

      // Track test file writes
      if (isTestFile(filePath)) {
        state.addWrittenTest(path.resolve(directory, filePath))
      }

      // Run tests after impl/test edits
      const absPath = path.resolve(directory, filePath)
      const testFile = isTestFile(filePath) ? absPath : findTestFile(absPath, directory)

      if (!testFile) return

      const result = await runTest(testFile, directory)

      if (!result.passed) {
        // Store failure — will block next tool.execute.before
        const relPath = path.relative(directory, filePath)
        state.setPendingFailure(relPath, result.output)
      } else {
        // Tests pass — clear any pending failure
        state.clearPendingFailure()
      }
    },
  }
}
```

**Estimate:** 3h ±1h

---

#### Task 1C.2: Create `.opencode/package.json`

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "latest"
  }
}
```

**Estimate:** 0.25h

---

#### Task 1C.3: Add TDD rules to OpenCode configuration

Create/update `AGENTS.md` or OpenCode rules file with TDD protocol (same content as CLAUDE.md additions but platform-agnostic framing).

**Estimate:** 0.5h

---

### Phase 1D: Testing shared core + adapters

#### Task 1D.1: Unit tests for shared core modules

Test `test-resolver.mjs`, `session-state.mjs`, `test-runner.mjs` with Bun test.

**Tests location:** `tests/hooks/tdd/` (following project convention)

**Estimate:** 3h ±1h

---

#### Task 1D.2: Integration tests for deferred blocking pattern

Verify the OpenCode deferred-blocking pattern works end-to-end:

1. Simulate `tool.execute.after` setting failure state
2. Verify `tool.execute.before` throws on next call
3. Verify clearing after tests pass

**Estimate:** 2h ±0.5h

---

## Risk Assessment Matrix

| Risk                                                                      | Probability | Impact | Mitigation                                                                          | Owner |
| ------------------------------------------------------------------------- | ----------- | ------ | ----------------------------------------------------------------------------------- | ----- |
| OpenCode `tool.execute.after` output format changes                       | Medium      | Medium | Pin `@opencode-ai/plugin` version; watch changelog                                  | Dev   |
| Deferred blocking feels laggy (1 tool call delay)                         | Medium      | Low    | Document trade-off; the blocked edit is already on disk; agent must fix regardless  | Dev   |
| OpenCode adds native PostToolUse blocking (issues #17412, #16626)         | High        | Low    | Positive risk — simplifies code. Add TODO to adopt when available                   | Dev   |
| Import paths break between `.hooks/` and `.claude/hooks/`                 | Low         | High   | Use relative imports; test CI with both platforms                                   | Dev   |
| OpenCode renames/restructures plugin events                               | Low         | High   | Pin plugin package version; monitor releases                                        | Dev   |
| `tool.execute.before` bug (issue #6862 — first message bypass)            | Medium      | Medium | Document known limitation; fixed in later versions; verify on current OpenCode      | Dev   |
| Shared modules use Node APIs unavailable in Bun                           | Low         | Low    | Use only `node:fs`, `node:path`, `node:child_process` — all in Bun                  | Dev   |
| `multiedit`/`patch` tools have different `args` shape than `edit`/`write` | Medium      | Medium | Audit OpenCode tool schemas before implementation; add tool-specific arg extraction | Dev   |

---

## OpenCode-Specific Known Limitations

### Current (as of v1.2.27)

1. **No `stop` hook** — Cannot prevent agent from stopping when tests are failing (issue #16626)
2. **No AI-visible message injection from hooks** — `tool.execute.after` output isn't seen by LLM (issue #17412)
3. **First-message bypass** — `tool.execute.before` may not fire on the very first message in a session (issue #6862)
4. **No `messageID` in hook payloads** — Cannot correlate tool calls to specific messages (issue #15933)

### Workarounds Applied

| Limitation              | Workaround                                                                         | Impact                                                    |
| ----------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| No PostToolUse blocking | Deferred blocking: store failure in state, block on next `tool.execute.before`     | 1 tool call delay; agent's broken edit is already on disk |
| No `stop` hook          | Use system prompt rules + `session.idle` event for logging only                    | Agent self-enforces; no mechanical enforcement at stop    |
| First-message bypass    | Document; likely fixed in newer versions; defense-in-depth via system prompt rules | Edge case: very first command in session might bypass     |

---

## Migration Path: When OpenCode Adds Missing Features

### If #17412 lands (AI-visible message injection from hooks)

- Remove deferred blocking pattern
- `tool.execute.after` directly injects test failure feedback
- Simplify `tool.execute.before` to only handle TDD gate (remove pending failure check)

### If #16626 lands (`session.stopping` hook)

- Add test-pass verification to the stop hook as final safety net
- Mirrors Claude Code's `Stop` hook behavior

### If both land

- Achieve full feature parity with Claude Code hooks
- Can simplify to same logical flow as Claude Code adapters

---

## Updated Project Structure (combined with original plan)

```
project/
├── .hooks/                              # NEW: Shared platform-agnostic core
│   └── tdd/
│       ├── test-resolver.mjs
│       ├── session-state.mjs
│       └── test-runner.mjs
│
├── .claude/                             # Claude Code (from original plan)
│   ├── settings.local.json              # MODIFY: add hook registrations
│   └── hooks/
│       ├── check-no-lint-suppression.sh # EXISTING
│       ├── enforce-tdd.mjs              # NEW: thin adapter
│       ├── enforce-tdd-tracker.mjs      # NEW: thin adapter
│       └── verify-tests-pass.mjs        # NEW: thin adapter
│
├── .opencode/                           # NEW: OpenCode plugin
│   ├── package.json                     # NEW: plugin dependencies
│   └── plugins/
│       └── tdd-enforcement.ts           # NEW: all hooks in one plugin
│
├── CLAUDE.md                            # MODIFY: add TDD protocol (both platforms)
├── AGENTS.md                            # NEW or MODIFY: OpenCode TDD rules
│
└── tests/
    └── hooks/                           # NEW: shared core tests
        └── tdd/
            ├── test-resolver.test.ts
            ├── session-state.test.ts
            └── test-runner.test.ts
```

---

## Implementation Order

```
Task 1A.1  ──┐
Task 1A.2  ──┼──→  Task 1B.1  ──┐
Task 1A.3  ──┘     Task 1B.2  ──┼──→  Task 1D.1  ──→  Task 1D.2
                    Task 1B.3  ──┤
                    Task 1C.1  ──┤
                    Task 1C.2  ──┘
                    Task 1C.3  ──────────────────────────────────→ Done
```

**Critical path:** Shared core (1A) → Claude adapters (1B) + OpenCode plugin (1C) in parallel → Tests (1D)

---

## Estimated Total Effort

| Phase                    | Tasks              | Estimate       |
| ------------------------ | ------------------ | -------------- |
| 1A: Shared core          | 1A.1 + 1A.2 + 1A.3 | 5.5h ±1.5h     |
| 1B: Claude Code adapters | 1B.1 + 1B.2 + 1B.3 | 2.5h ±1h       |
| 1C: OpenCode plugin      | 1C.1 + 1C.2 + 1C.3 | 3.75h ±1h      |
| 1D: Tests                | 1D.1 + 1D.2        | 5h ±1.5h       |
| **Total**                |                    | **16.75h ±5h** |

**Delta vs Claude-only plan:** +8h for shared core extraction + OpenCode plugin + additional tests. The original Claude-only plan would take ~8-10h; the multi-platform version adds roughly the same again in shared infrastructure and the OpenCode adapter.

---

## Quality Gate Checklist (extends original plan)

### Shared Core

- [ ] `.hooks/tdd/test-resolver.mjs` — all test resolution tests pass
- [ ] `.hooks/tdd/session-state.mjs` — both File and Memory backends work
- [ ] `.hooks/tdd/test-runner.mjs` — runs bun test, handles timeout

### Claude Code Adapters

- [ ] All original plan quality gates met (see `2026-03-23-tdd-hooks-integration.md`)
- [ ] Adapters import from `.hooks/tdd/` — no duplicated logic

### OpenCode Plugin

- [ ] `.opencode/plugins/tdd-enforcement.ts` loads in OpenCode without errors
- [ ] TDD gate: impl write without test → `tool.execute.before` throws Error
- [ ] Tracker: test file write → recorded in session state
- [ ] Test runner: impl edit with failing test → pending failure stored
- [ ] Deferred blocking: pending failure → next `tool.execute.before` throws Error
- [ ] Clear on pass: passing test run → pending failure cleared
- [ ] `@opencode-ai/plugin` types — no TypeScript errors

### Cross-Platform

- [ ] Both platforms use identical test resolution logic
- [ ] Both platforms give identical TDD violation messages
- [ ] Session state isolation: Claude sessions don't interfere with OpenCode sessions

---

## Library Research: `@opencode-ai/plugin`

| Field          | Value                                                           |
| -------------- | --------------------------------------------------------------- |
| Package        | `@opencode-ai/plugin`                                           |
| Purpose        | TypeScript types + `tool()` helper for OpenCode plugins         |
| Auto-installed | Yes — OpenCode installs to `.opencode/node_modules/` at startup |
| License        | MIT (same as OpenCode)                                          |
| Maintenance    | Active (maintained by core team, anomalyco)                     |
| Latest version | Matches OpenCode releases                                       |
| Security       | No known vulnerabilities                                        |
| Types provided | `Plugin`, `tool()`, `tool.schema` (Zod)                         |

No additional libraries needed — the shared core uses only Node.js built-ins (`node:fs`, `node:path`, `node:child_process`).

---

## References

- [OpenCode Plugins Documentation](https://opencode.ai/docs/plugins/)
- [OpenCode Permissions](https://opencode.ai/docs/permissions)
- [OpenCode Custom Tools](https://opencode.ai/docs/custom-tools)
- [OpenCode GitHub](https://github.com/anomalyco/opencode) (126K stars, MIT, TypeScript)
- [Issue #17412: Plugin hooks should inject AI-visible messages](https://github.com/anomalyco/opencode/issues/17412)
- [Issue #16626: Add session.stopping hook](https://github.com/anomalyco/opencode/issues/16626)
- [Issue #10027: tool.execute.error hook](https://github.com/anomalyco/opencode/issues/10027) (merged)
- [Issue #2897: tool.execute.after output format](https://github.com/anomalyco/opencode/issues/2897) (fixed)
- [Issue #6862: tool.execute.before first-message bypass](https://github.com/anomalyco/opencode/issues/6862)
- [OpenCode Plugins Guide (community gist)](https://gist.github.com/johnlindquist/0adf1032b4e84942f3e1050aba3c5e4a)
- [Claude Code Hooks Documentation](https://docs.anthropic.com/en/docs/claude-code/hooks)
