# TDD Hooks Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Use @test-driven-development skill for all code changes.

**Goal:** Integrate prototype TDD enforcement hooks from `docs/tdd-hooks/` into all three AI
tools used in this project (Claude Code, opencode, GitHub Copilot) so that AI assistants are
mechanically prevented from writing implementation code without tests, and cannot regress
existing tests during refactoring.

**Source:** `docs/tdd-hooks/` (7 hook scripts + README + SYSTEM_PROMPT + settings.json)

**Target:** `.hooks/tdd/` (shared core) + `.claude/hooks/` + `.opencode/plugins/` +
`.github/instructions/` (committed to repo)

**Supersedes:** `2026-03-23-multi-agent-tdd-hooks.md` (merged into this plan)

---

## Platform Comparison (Verified March 2026)

| Aspect                   | Claude Code                                              | OpenCode (v1.2.27+)                                             |
| ------------------------ | -------------------------------------------------------- | --------------------------------------------------------------- |
| **Hook execution model** | Subprocess (shell command via `node`)                    | In-process function callback                                    |
| **Input delivery**       | JSON on stdin                                            | Function parameters `(input, output)`                           |
| **PreToolUse block**     | `{ hookSpecificOutput: { permissionDecision: "deny" } }` | `throw new Error("reason")`                                     |
| **PostToolUse block**    | `{ decision: "block", reason: "..." }`                   | **NOT POSSIBLE** — deferred blocking workaround required        |
| **Tool name format**     | PascalCase (`Write`, `Edit`)                             | lowercase (`write`, `edit`, `patch`, `multiedit`)               |
| **File path field**      | `tool_input.file_path`                                   | `output.args.filePath` (before) / `input.args.filePath` (after) |
| **Session ID**           | `session_id` (snake_case)                                | `sessionID` (camelCase), available on both hook inputs          |
| **Project root**         | `cwd` from input JSON                                    | `directory` from plugin context closure (absolute path)         |
| **Registration**         | `.claude/settings.json` hooks config                     | Auto-load from `.opencode/plugins/`                             |
| **Tool matchers**        | Regex pattern (`Write\|Edit`)                            | Manual `if (input.tool === ...)` check                          |
| **Session state**        | File-based (`/tmp/tdd-session-*`)                        | In-memory Map (closure persists across calls)                   |
| **Hook parallelism**     | All matching hooks run **in parallel**                   | Sequential per plugin                                           |
| **Crash behavior**       | Exit ≠ 0,2 → fail-open (tool proceeds)                   | Uncaught throw → error logged, tool proceeds                    |

### OpenCode-Specific Limitations

1. **No PostToolUse blocking** — `tool.execute.after` cannot block or inject AI-visible messages (issues [#17412](https://github.com/anomalyco/opencode/issues/17412), [#16626](https://github.com/anomalyco/opencode/issues/16626) — both open)
2. **Subagent bypass** — plugin hooks do not intercept subagent tool calls ([#5894](https://github.com/anomalyco/opencode/issues/5894) — open)
3. **First-message bypass** — `tool.execute.before` may not fire on the very first tool call in a new session ([#6862](https://github.com/anomalyco/opencode/issues/6862) — open)
4. **`patch` tool ungatable** — uses `patchText` string, not `filePath`; file paths are embedded in patch text and require parsing

### OpenCode Tool Argument Shapes

| Tool        | `filePath` field? | Gateable? | Notes                                    |
| ----------- | ----------------- | --------- | ---------------------------------------- |
| `write`     | Yes               | Yes       | `args.filePath`                          |
| `edit`      | Yes               | Yes       | `args.filePath`                          |
| `multiedit` | Yes               | Yes       | Top-level `args.filePath` is target file |
| `patch`     | No                | No        | Uses `args.patchText` (freeform string)  |

---

## Analysis of Prototype vs Project Reality

### Critical Mismatches Requiring Adaptation

| Area                | Prototype Assumes                | This Project Uses                                   | Fix Required                                   |
| ------------------- | -------------------------------- | --------------------------------------------------- | ---------------------------------------------- |
| Test runner         | Vitest / Jest                    | Bun test                                            | Rewrite runner detection                       |
| Test location       | Colocated (`src/foo.test.ts`)    | Parallel dir (`tests/foo.test.ts`)                  | Rewrite file resolution                        |
| Test subdir mapping | None / `__tests__/`              | `tests/providers/`, `tests/tools/`, etc.            | Mirror `src/` → `tests/`                       |
| PreToolUse output   | `decision: "block"` (deprecated) | `hookSpecificOutput.permissionDecision: "deny"`     | Fix JSON output format                         |
| Tool name matcher   | `Write\|Edit\|MultiEdit`         | `Write\|Edit` (no MultiEdit in Claude Code)         | Fix matcher                                    |
| Stryker test runner | `vitest`                         | `bun` via `@hughescr/stryker-bun-runner`            | Use project's Stryker config                   |
| Coverage            | `npx vitest --coverage`          | `bun test --coverage` (no coverage-final.json)      | Use Bun coverage or skip                       |
| ESM in hooks        | `import` syntax in `.js`         | Shell runs hooks; `node` must be invoked explicitly | Use `.mjs` extension + explicit `node` command |
| Script path ref     | Hardcoded relative               | `$CLAUDE_PROJECT_DIR` env var                       | Use Claude Code convention                     |
| Code duplication    | `extractSurface()` in 2 files    | `findTestFile()` needed in 3+ hooks                 | Extract to `.hooks/tdd/test-resolver.mjs`      |

### What Works As-Is

- Session state files in `/tmp/tdd-session-*` pattern (Claude Code)
- Concept of tracking test files written per session
- Refactor guards (new exports, new params detection)
- Mutation testing survivor diffing logic

---

## Decision: Scope of Integration

### Phase 1 — Core TDD Gate (this plan)

**In scope:**

1. Shared core logic in `.hooks/tdd/` (platform-agnostic ES modules)
2. Claude Code adapter hooks in `.claude/hooks/` (thin wrappers)
3. OpenCode plugin in `.opencode/plugins/` (with deferred blocking)
4. Settings merge into `.claude/settings.json` (shared, committed to repo)
5. TDD instructions for all three AI tools:
   - `CLAUDE.md` — Claude Code + opencode (native fallback)
   - `.github/instructions/tdd.instructions.md` — Copilot + opencode (via plugin)
   - `.github/copilot-instructions.md` — table update
6. Unit tests for shared core in `tests/hooks/tdd/`

**Out of scope (Phase 2):**

- `snapshot-before-edit.js` + `verify-no-new-functionality.js` (refactor guards)
- `mutation-snapshot.js` + `mutation-verify.js` (mutation testing hooks)
- These require coverage infrastructure changes and add 30-120s per edit

### Rationale

The core TDD gate provides 80% of the value: it prevents writing implementation without
tests and catches regressions immediately. The refactor guards and mutation hooks add
latency (coverage + Stryker runs) and require more complex infrastructure adaptation.
They can be layered on once the core hooks are proven stable.

---

## Architecture

```
project/
├── .hooks/                              # Shared platform-agnostic core
│   └── tdd/
│       ├── test-resolver.mjs            # Find test file for impl file
│       ├── session-state.mjs            # Session state (File + Memory backends)
│       └── test-runner.mjs              # Execute bun test, parse results
│
├── .claude/                             # Claude Code adapter layer
│   ├── settings.json                    # NEW: TDD hook registration (shared, committed)
│   ├── settings.local.json              # Existing: permissions + Stop hook (local only)
│   └── hooks/
│       ├── check-no-lint-suppression.sh # Existing Stop hook
│       ├── enforce-tdd.mjs              # NEW: PreToolUse — thin adapter
│       ├── enforce-tdd-tracker.mjs      # NEW: PostToolUse — thin adapter
│       └── verify-tests-pass.mjs        # NEW: PostToolUse — thin adapter
│
├── .opencode/                           # OpenCode adapter layer
│   ├── package.json                     # NEW: { "dependencies": { "@opencode-ai/plugin": "latest" } }
│   └── plugins/
│       └── tdd-enforcement.ts           # NEW: single plugin, all hooks
│
├── .github/
│   ├── copilot-instructions.md          # MODIFY: add tdd.instructions.md to table
��   └── instructions/
│       ├── ... (7 existing files)
│       └── tdd.instructions.md          # NEW: TDD protocol for Copilot + opencode
│
├── CLAUDE.md                            # MODIFY: add TDD Enforcement section
│
└── tests/
    └── hooks/                           # NEW: shared core tests
        └── tdd/
            ├── test-resolver.test.ts
            ├── session-state.test.ts
            └── test-runner.test.ts
```

### Multi-Tool Enforcement Strategy

| Tool           | Mechanical enforcement (hooks)                                       | Instruction-level (advisory)                              |
| -------------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| Claude Code    | `.claude/settings.json` → PreToolUse/PostToolUse hooks               | `CLAUDE.md` TDD section                                   |
| opencode       | `.opencode/plugins/tdd-enforcement.ts` → `tool.execute.before/after` | `CLAUDE.md` (native) + `tdd.instructions.md` (via plugin) |
| GitHub Copilot | _(none — no confirmed hook execution support)_                       | `tdd.instructions.md` (auto-loaded by glob)               |

#### OpenCode deferred blocking pattern

OpenCode's `tool.execute.after` cannot block or inject AI-visible messages. The workaround:

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

**Trade-off:** The first broken edit goes through (tool already executed), but the agent is
blocked from doing _anything else_ until tests pass. Functionally equivalent to Claude Code's
behavior since the agent must fix tests before proceeding.

### Test File Resolution Strategy

This project uses a parallel `tests/` directory that mirrors `src/`:

```
src/config.ts              → tests/config.test.ts
src/providers/kaneo/client.ts → tests/providers/kaneo/client.test.ts
src/tools/task-tools.ts    → tests/tools/task-tools.test.ts
src/utils/format.ts        → tests/utils/format.test.ts
```

The hooks must:

1. Strip `src/` prefix from implementation path
2. Prepend `tests/` prefix
3. Replace `.ts` with `.test.ts`
4. Also check for direct colocated patterns (fallback)

This logic lives once in `.hooks/tdd/test-resolver.mjs` and is imported by all adapters.

### Hook Execution Environment

Claude Code runs hooks via the **system shell** (bash/zsh), not Node.js directly. Hook commands
in `settings.json` are shell commands — to run a `.mjs` file, the command must explicitly invoke
`node`. Since the project uses ESM (`"type": "module"` in package.json), Node.js handles
`import` syntax natively. The `.mjs` extension forces ESM regardless of `package.json`.

**ESM import resolution:** Relative imports in `.mjs` files resolve relative to the importing
file's location, not the working directory. So `.claude/hooks/enforce-tdd.mjs` importing from
`../../.hooks/tdd/test-resolver.mjs` resolves correctly regardless of `cwd`. Dotfile directories
(`.hooks/`, `.claude/`) have no special handling in Node ESM resolution.

**Decision:** Use `.mjs` extension with `node "$CLAUDE_PROJECT_DIR"/.claude/hooks/<file>.mjs`
in the settings command. Shebangs are unused (shell invokes `node` explicitly, not the script
directly), so they are omitted from hook files. `chmod +x` is not needed.

### Available Hook Features (Not Used in Phase 1)

These Claude Code hook features are available but intentionally deferred to keep Phase 1 simple:

- **`if` field** (v2.1.85+) — permission-rule syntax for filtering, e.g. `"if": "Edit(src/*.ts)"`.
  Could replace the in-script path filtering, but adds coupling to settings schema.
- **`async: true`** — non-blocking hook execution. The tracker hook could use this since it
  doesn't need to block, but the overhead is negligible.
- **Exit code 2** — alternative blocking mechanism where stderr is sent to Claude as feedback.
  Simpler than JSON output for `verify-tests-pass.mjs`, but less structured.

---

## Detailed Task Breakdown

### Phase A: Shared Core Modules

#### Task A1: Create `.hooks/tdd/test-resolver.mjs`

**Files:** Create `.hooks/tdd/test-resolver.mjs`

**Extract from:** Prototype `findTestFile()` logic duplicated across hooks.

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
 * @param {string} projectRoot - Project root directory
 * @returns {boolean} - True if this is a gateable implementation file (src/**/*.ts)
 */
export function isGateableImplFile(filePath, projectRoot) { ... }

/**
 * @param {string} implRelPath - Relative path from projectRoot (e.g. src/foo/bar.ts)
 * @returns {string} - Suggested test file relative path (e.g. tests/foo/bar.test.ts)
 */
export function suggestTestPath(implRelPath) { ... }
```

**Implementation details:**

- `IMPL_PATTERN = /\.(?:ts|js|tsx|jsx)$/`
- `TEST_PATTERN = /\.(?:test|spec)\.(?:ts|js|tsx|jsx)$/`
- `findTestFile`: `src/foo/bar.ts` → `tests/foo/bar.test.ts` with colocated fallback
- `isGateableImplFile`: must be under `src/`, match IMPL_PATTERN, not match TEST_PATTERN
- Pure functions except `findTestFile` (uses `fs.existsSync`)

**Commit:** `feat: add shared TDD test resolver module`

---

#### Task A2: Create `.hooks/tdd/session-state.mjs`

**Files:** Create `.hooks/tdd/session-state.mjs`

**Two backends for different execution models:**

```javascript
/**
 * File-based backend (Claude Code — hooks run as subprocesses, no shared memory)
 */
export class FileSessionState {
  constructor(sessionId, stateDir = '/tmp') { ... }
  getWrittenTests() { ... }         // returns string[]
  addWrittenTest(path) { ... }      // appends to list
  getPendingFailure() { ... }       // returns { file, output } | null
  setPendingFailure(file, output) { ... }
  clearPendingFailure() { ... }
}

/**
 * Memory-based backend (OpenCode — plugin runs in-process, closure persists)
 */
export class MemorySessionState {
  static sessions = new Map()
  constructor(sessionId) { ... }
  // Same interface as FileSessionState
}
```

**Implementation details:**

- Both backends implement identical interface
- `FileSessionState` path: `/tmp/tdd-session-{sessionId}.json`
- `FileSessionState` handles missing/corrupt state files gracefully (returns empty state)
- `MemorySessionState` keys by `sessionId` in a static Map

**Commit:** `feat: add shared TDD session state module`

---

#### Task A3: Create `.hooks/tdd/test-runner.mjs`

**Files:** Create `.hooks/tdd/test-runner.mjs`

```javascript
/**
 * @param {string} testFilePath - Absolute path to test file
 * @param {string} projectRoot - Project root for cwd
 * @returns {Promise<{ passed: boolean, output: string }>}
 */
export async function runTest(testFilePath, projectRoot) { ... }
```

**Implementation details:**

- Spawns `bun test <file>` with `execSync`, 30s timeout
- Captures stdout + stderr
- Returns `{ passed, output }` (output truncated to 3000 chars)
- Handles timeout gracefully: `{ passed: false, output: "Test timed out after 30s" }`

**Commit:** `feat: add shared TDD test runner module`

---

### Phase B: Claude Code Adapters

#### Task B1: Create `enforce-tdd.mjs` — PreToolUse adapter

**Files:** Create `.claude/hooks/enforce-tdd.mjs`

**What it does:** Before any `Write` or `Edit` tool call on an implementation file, checks that
a corresponding test file exists (either on disk or written earlier in the session). Blocks the
tool call if no test file found.

**Implementation outline:**

```javascript
// PreToolUse — enforce TDD: tests must exist before implementation

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

if (findTestFile(absPath, cwd)) process.exit(0)

const state = new FileSessionState(session_id)
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
        `Write a failing test first:\n` +
        `  → ${suggestedTest}\n\n` +
        `Then re-attempt writing the implementation.`,
    },
  }),
)
process.exit(0)
```

**Commit:** `feat: add enforce-tdd hook for TDD gate`

---

#### Task B2: Create `enforce-tdd-tracker.mjs` — PostToolUse adapter

**Files:** Create `.claude/hooks/enforce-tdd-tracker.mjs`

**What it does:** After any `Write` or `Edit` of a test file, records the test file path in the
session state file. This lets `enforce-tdd.mjs` know that a test was written this session even
if it hasn't been saved to disk in the expected location yet.

**Implementation outline:**

```javascript
// PostToolUse — record when a test file is written this session

import fs from 'node:fs'
import path from 'node:path'
import { isTestFile } from '../../.hooks/tdd/test-resolver.mjs'
import { FileSessionState } from '../../.hooks/tdd/session-state.mjs'

const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
const { tool_name, tool_input, session_id } = input

if (tool_name !== 'Write' && tool_name !== 'Edit') process.exit(0)

const filePath = tool_input.file_path
if (!filePath || !isTestFile(filePath)) process.exit(0)

const state = new FileSessionState(session_id)
state.addWrittenTest(path.resolve(filePath))

process.exit(0)
```

**Commit:** `feat: add enforce-tdd-tracker hook for session state`

---

#### Task B3: Create `verify-tests-pass.mjs` — PostToolUse adapter

**Files:** Create `.claude/hooks/verify-tests-pass.mjs`

**What it does:** After any impl or test file write, finds the corresponding test file and runs
it with `bun test`. If tests fail, outputs a `decision: "block"` response so Claude gets the
error feedback. Note: `{ "decision": "block", "reason": "..." }` is the correct format for
PostToolUse hooks (distinct from PreToolUse which uses `hookSpecificOutput.permissionDecision`).

**Implementation outline:**

```javascript
// PostToolUse — after every file write, run related tests.
// If tests fail, block the agent so it must fix before proceeding.

import fs from 'node:fs'
import path from 'node:path'
import { findTestFile, isTestFile } from '../../.hooks/tdd/test-resolver.mjs'
import { runTest } from '../../.hooks/tdd/test-runner.mjs'

const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
const { tool_name, tool_input, cwd } = input

if (tool_name !== 'Write' && tool_name !== 'Edit') process.exit(0)

const filePath = tool_input.file_path
if (!filePath) process.exit(0)

const IMPL_PATTERN = /\.(?:ts|js|tsx|jsx)$/
if (!IMPL_PATTERN.test(filePath)) process.exit(0)

const absPath = path.resolve(filePath)
const testFile = isTestFile(filePath) ? absPath : findTestFile(absPath, cwd)
if (!testFile) process.exit(0)

const result = await runTest(testFile, cwd)

if (!result.passed) {
  const relFile = path.relative(cwd, filePath)
  console.log(
    JSON.stringify({
      decision: 'block',
      reason:
        `Tests are RED after your edit of \`${relFile}\`.\n\n` +
        `You must fix the failing tests before proceeding.\n\n` +
        `── Test output ──────────────────────────────\n` +
        `${result.output}\n` +
        `─────────────────────────────────────────────\n\n` +
        `Fix the regression, then re-attempt.`,
    }),
  )
}

process.exit(0)
```

**Commit:** `feat: add verify-tests-pass hook for test regression gate`

---

#### Task B4: Merge hook registration into settings

**Files:** Create `.claude/settings.json` (shared, committed to repo)

TDD hooks go in `.claude/settings.json` (not `settings.local.json`) so they are committed
to the repo and available to all contributors. The existing `settings.local.json` retains
permissions and the Stop hook (local-only concerns). Claude Code merges both files (local
takes precedence).

**Create `.claude/settings.json` with hook registrations:**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/enforce-tdd.mjs",
            "statusMessage": "Checking TDD compliance..."
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/enforce-tdd-tracker.mjs"
          },
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/verify-tests-pass.mjs",
            "timeout": 60,
            "statusMessage": "Running tests..."
          }
        ]
      }
    ]
  }
}
```

**Note:** PostToolUse hooks run in parallel. The tracker and test-runner don't share state
files, so no race condition exists between them.

**Commit:** `feat: register TDD hooks in settings.json`

---

### Phase C: OpenCode Plugin

#### Task C1: Create `.opencode/plugins/tdd-enforcement.ts`

**Files:** Create `.opencode/plugins/tdd-enforcement.ts`

**What it does:** Single plugin implementing all three TDD hooks via opencode's plugin API.
Uses the deferred blocking pattern for test verification (since `tool.execute.after` cannot
block).

**Key design decisions:**

- Named export async factory function — required by opencode plugin API
- Uses `directory` from plugin context for project root (absolute path)
- Uses `input.sessionID` (camelCase) for per-session state tracking
- Gates `write`, `edit`, and `multiedit` tools (all use `args.filePath`)
- Does NOT gate `patch` tool (uses `patchText`, not `filePath` — ungatable without parsing)
- Uses `MemorySessionState` backend (plugin runs in-process, closure persists)

**Implementation outline:**

```typescript
// .opencode/plugins/tdd-enforcement.ts
// OpenCode plugin — TDD enforcement: gate + tracker + test runner with deferred blocking

import type { Plugin } from '@opencode-ai/plugin'
import path from 'node:path'
import { findTestFile, isTestFile, isGateableImplFile, suggestTestPath } from '../../.hooks/tdd/test-resolver.mjs'
import { MemorySessionState } from '../../.hooks/tdd/session-state.mjs'
import { runTest } from '../../.hooks/tdd/test-runner.mjs'

// OpenCode edit tools that use filePath (excludes patch — uses patchText)
const EDIT_TOOLS = new Set(['write', 'edit', 'multiedit'])

export const TddEnforcement: Plugin = async ({ directory }) => {
  return {
    // ─── enforce-tdd + deferred test-failure blocking ───
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

    // ─── enforce-tdd-tracker + verify-tests-pass (deferred) ───
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

**Prerequisite:** The `@opencode-ai/plugin` types package is declared in `.opencode/package.json`
and auto-installed by opencode at startup via `bun install`.

**Commit:** `feat: add opencode TDD enforcement plugin`

---

#### Task C2: Create `.opencode/package.json`

**Files:** Create `.opencode/package.json`

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "latest"
  }
}
```

**Commit:** `chore: add opencode plugin dependencies`

---

### Phase D: TDD Instructions

#### Task D1: Modify `CLAUDE.md`

Add after the existing "## Testing" section:

```markdown
## TDD Enforcement (Hooks)

Claude Code hooks enforce Red → Green → Refactor at the tool level. Violations are
blocked before the file write completes.

### Phase Rules

**Red — Write a failing test first:**

- Before touching ANY implementation file in `src/`, write a failing test in `tests/`
- The test file MUST exist before the implementation file is created or edited
- Hooks will block impl writes if no test file exists

**Green — Minimum code to pass:**

- Write the simplest implementation that makes the failing test pass
- Do NOT add logic beyond what the test requires
- After every file write, tests are run automatically
- If tests go RED, stop and fix before proceeding

**Refactor — Clean up without changing behavior:**

- Keep all existing tests GREEN throughout

### Hard Rules

1. Never touch an implementation file before its test file exists
2. Never proceed past a RED test, even temporarily
3. Test naming: `src/foo/bar.ts` → `tests/foo/bar.test.ts`

### Disabling TDD Hooks

For non-code edits (docs, config), hooks automatically allow: only `src/**/*.ts`
files are gated. For exceptional cases, temporarily remove the hook entries from
`.claude/settings.json`.
```

---

#### Task D2: Create `.github/instructions/tdd.instructions.md`

This gives Copilot and opencode (via plugin) the same TDD protocol, scoped to `src/**`.

```markdown
---
applyTo: 'src/**'
---

# TDD Workflow — Red → Green → Refactor

Every implementation change in `src/` MUST follow the TDD cycle. This is enforced
by hooks in Claude Code but applies as a mandatory workflow for all AI tools.

## Before editing any file in `src/`

1. Check that a corresponding test file exists: `src/foo/bar.ts` → `tests/foo/bar.test.ts`
2. If no test file exists, create one FIRST with a failing test
3. Only then proceed to edit the implementation file

## After editing any file in `src/`

1. Run the related test: `bun test tests/foo/bar.test.ts`
2. If tests fail, fix the implementation before proceeding
3. Do NOT move on with failing tests

## Hard Rules

1. Never touch an implementation file before its test file exists
2. Never proceed past a RED test, even temporarily
3. Test naming convention: `src/foo/bar.ts` → `tests/foo/bar.test.ts`
4. Write the minimum implementation to make tests pass — no speculative code
```

---

#### Task D3: Update `.github/copilot-instructions.md` table

Add the new instruction file to the path-scoped guidelines table:

```markdown
| `tdd.instructions.md` | `src/**` | TDD workflow: test-first, Red→Green→Refactor |
```

**Commit:** `docs: add TDD enforcement protocol to CLAUDE.md, Copilot, and opencode`

---

### Phase E: Tests and Verification

#### Task E1: Unit tests for shared core

**Files:** Create `tests/hooks/tdd/test-resolver.test.ts`, `tests/hooks/tdd/session-state.test.ts`, `tests/hooks/tdd/test-runner.test.ts`

Test coverage:

- `test-resolver`: all resolution paths (parallel dir, colocated fallback, non-src skip, non-ts skip)
- `session-state`: both `FileSessionState` and `MemorySessionState` backends (read/write/clear, corrupt file handling)
- `test-runner`: passing test, failing test, timeout handling

**Commit:** `test: add unit tests for shared TDD core modules`

---

#### Task E2: End-to-end verification (Claude Code)

**Note:** `chmod +x` is not needed — hooks are invoked via `node <file>` in settings, not
executed directly by the shell.

**End-to-end test scenarios:**

1. **Impl write WITH existing test → allowed:**

   ```bash
   echo '{"tool_name":"Write","tool_input":{"file_path":"'$PWD'/src/config.ts","content":"x"},"session_id":"e2e","cwd":"'$PWD'","hook_event_name":"PreToolUse"}' | node .claude/hooks/enforce-tdd.mjs
   echo $?  # should be 0, no JSON output
   ```

2. **Impl write WITHOUT test → blocked:**

   ```bash
   echo '{"tool_name":"Write","tool_input":{"file_path":"'$PWD'/src/brand-new.ts","content":"x"},"session_id":"e2e","cwd":"'$PWD'","hook_event_name":"PreToolUse"}' | node .claude/hooks/enforce-tdd.mjs
   # should output JSON with permissionDecision: "deny"
   ```

3. **Test write → tracked in session:**

   ```bash
   echo '{"tool_name":"Write","tool_input":{"file_path":"'$PWD'/tests/brand-new.test.ts","content":"x"},"session_id":"e2e","cwd":"'$PWD'","hook_event_name":"PostToolUse","tool_response":{"success":true}}' | node .claude/hooks/enforce-tdd-tracker.mjs
   cat /tmp/tdd-session-e2e.json
   ```

4. **After tracking, impl write → now allowed:**

   ```bash
   echo '{"tool_name":"Write","tool_input":{"file_path":"'$PWD'/src/brand-new.ts","content":"x"},"session_id":"e2e","cwd":"'$PWD'","hook_event_name":"PreToolUse"}' | node .claude/hooks/enforce-tdd.mjs
   echo $?  # should be 0
   rm -f /tmp/tdd-session-e2e.json
   ```

5. **Test runner catches failures:**
   ```bash
   echo '{"tool_name":"Write","tool_input":{"file_path":"'$PWD'/src/errors.ts","content":"x"},"session_id":"e2e","cwd":"'$PWD'","hook_event_name":"PostToolUse","tool_response":{"success":true}}' | node .claude/hooks/verify-tests-pass.mjs
   # Should exit 0 with no output (tests/errors.test.ts passes)
   ```

---

#### Task E3: Integration test for deferred blocking (OpenCode)

Verify the deferred-blocking pattern works end-to-end:

1. Simulate `tool.execute.after` setting failure state
2. Verify `tool.execute.before` throws on next call
3. Verify clearing after tests pass

**Commit:** `test: verify TDD hooks end-to-end`

---

### Phase F: Cleanup

#### Task F1: Clean up prototype docs

Add a note to `docs/tdd-hooks/README.md`:

```markdown
---

## Status

This directory contains the **prototype** hooks. The production-ready, project-adapted
versions live in `.hooks/tdd/` (shared core) + `.claude/hooks/` (Claude Code adapters) +
`.opencode/plugins/` (OpenCode adapter). Key differences:

- Uses Bun test runner instead of Vitest/Jest
- Resolves test files in `tests/` parallel directory (not colocated)
- Uses correct Claude Code hook output format (`hookSpecificOutput.permissionDecision`)
- Scoped to `src/**/*.ts` files only
- Shared core logic eliminates duplication across platforms
```

#### Task F2: Mark multi-agent plan as superseded

Add a note to `docs/plans/2026-03-23-multi-agent-tdd-hooks.md`:

```markdown
> **Status:** Superseded — merged into `2026-03-23-tdd-hooks-integration.md`.
```

**Commit:** `docs: note prototype vs production hook locations`

---

## Implementation Order

```
Phase A (shared core):
  Task A1 (test-resolver) ──┐
  Task A2 (session-state) ──┼──→ Phase B (Claude Code adapters):
  Task A3 (test-runner)   ──┘      Task B1 (enforce-tdd)     ──┐
                                    Task B2 (tracker)          ──┼──→ Phase E (tests):
                                    Task B3 (verify-tests)     ──┤      Task E1 (unit tests)
                                    Task B4 (settings.json)    ──┤      Task E2 (Claude e2e)
                                                                 │      Task E3 (OpenCode e2e)
                                  Phase C (OpenCode plugin):     │
                                    Task C1 (plugin)           ──┤
                                    Task C2 (package.json)     ──┘
                                                                       Phase F (cleanup):
                                  Phase D (instructions):                Task F1 + F2
                                    Task D1 (CLAUDE.md)        ──→
                                    Task D2 (tdd.instructions)
                                    Task D3 (copilot table)
```

**Critical path:** A → B+C (parallel) → E → F. Phase D is independent.

---

## Risk Assessment Matrix

| Risk                                                   | Probability | Impact | Mitigation                                                                                        | Owner |
| ------------------------------------------------------ | ----------- | ------ | ------------------------------------------------------------------------------------------------- | ----- |
| Hook blocks legitimate edits (false positive)          | Medium      | High   | Only gate `src/` files; allow config/docs freely. Remove hooks from settings as escape hatch      | Dev   |
| Test runner timeout slows Claude                       | Medium      | Medium | 30s timeout on `bun test` per file; Bun is fast; test only the related file, not full suite       | Dev   |
| Hook crashes on malformed JSON                         | Low         | Medium | Wrap stdin parsing in try/catch, exit 0 on error (fail open)                                      | Dev   |
| Session state file races (parallel hooks)              | Low         | Low    | Hooks run in parallel, but tracker and test-runner don't share state files; no actual race        | Dev   |
| Node.js ESM resolution fails in hook                   | Low         | High   | `.mjs` forces ESM; relative imports resolve from file location (verified); verify on setup        | Dev   |
| OpenCode plugin bypassed via subagent                  | Medium      | Medium | Known issue (#5894); instructions provide fallback enforcement; direct + MCP calls work           | Dev   |
| OpenCode first-message bypass                          | Medium      | Low    | Known issue (#6862); first tool call in session may bypass gate; instructions provide fallback    | Dev   |
| OpenCode `patch` tool bypasses TDD gate                | Medium      | Low    | `patch` uses `patchText` not `filePath`; ungatable without parsing; instructions provide fallback | Dev   |
| OpenCode plugin API changes                            | Low         | Medium | Plugin is simple; pin `@opencode-ai/plugin` version if needed; monitor changelog                  | Dev   |
| Import paths break between `.hooks/` and adapters      | Low         | High   | Relative ESM imports resolve from file location; tested with dotfile dirs; CI validates both      | Dev   |
| Deferred blocking feels laggy (1 tool call delay)      | Medium      | Low    | First broken edit goes through, but agent is fully blocked thereafter; functionally equivalent    | Dev   |
| OpenCode adds native PostToolUse blocking (#17412)     | High        | Low    | Positive risk — simplifies code; add TODO to adopt when available                                 | Dev   |
| `multiedit`/`patch` have different arg shape than edit | Medium      | Medium | `multiedit` confirmed to use `filePath`; `patch` excluded; audit before implementation            | Dev   |

---

## Phase 2 — Refactor Guards (future)

When Phase 1 is stable, add:

### Refactor Guard Hooks

1. **`snapshot-before-edit.mjs`** — PreToolUse: snapshot public API surface before edit
2. **`verify-no-new-functionality.mjs`** — PostToolUse: compare surface, block new exports/params

**Adaptations needed:**

- Replace Vitest coverage with `bun test --coverage` (Bun outputs lcov, not istanbul JSON)
- Parse Bun's coverage output format for statement coverage
- Extract shared `extractSurface()` to `.hooks/tdd/surface.mjs`

### Mutation Testing Hooks

3. **`mutation-snapshot.mjs`** — PreToolUse: run Stryker, snapshot survivors
4. **`mutation-verify.mjs`** — PostToolUse: diff survivors, block on new

**Adaptations needed:**

- Use project's existing `stryker.config.json` with `testRunner: "bun"`
- Use `@hughescr/stryker-bun-runner` (already installed)
- Add `TDD_MUTATION` env var toggle
- Expect 30-120s per hook pair — only enable for final verification

---

## Migration Path: When OpenCode Adds Missing Features

### If #17412 lands (AI-visible message injection from hooks)

- Remove deferred blocking pattern from `tool.execute.before`
- `tool.execute.after` directly injects test failure feedback
- Simplify to same logical flow as Claude Code adapters

### If #16626 lands (`session.stopping` hook)

- Add test-pass verification to the stop hook as final safety net

---

## Quality Gate Checklist

### Shared Core

- [ ] `.hooks/tdd/test-resolver.mjs` — all resolution tests pass
- [ ] `.hooks/tdd/session-state.mjs` — both File and Memory backends work
- [ ] `.hooks/tdd/test-runner.mjs` — runs bun test, handles timeout

### Claude Code Adapters

- [ ] All 3 hooks created in `.claude/hooks/` (`.mjs` extension)
- [ ] `.claude/settings.json` created with PreToolUse and PostToolUse registrations
- [ ] Existing `Stop` hook in `settings.local.json` preserved (unmodified)
- [ ] Adapters import from `.hooks/tdd/` — no duplicated logic
- [ ] Manual verification: impl write without test → blocked
- [ ] Manual verification: impl write with test → allowed
- [ ] Manual verification: test write + then impl write → allowed via session tracking
- [ ] Manual verification: edit that breaks test → blocked with test output

### OpenCode Plugin

- [ ] `.opencode/plugins/tdd-enforcement.ts` loads in opencode without errors
- [ ] TDD gate: impl write without test → `tool.execute.before` throws Error
- [ ] Tracker: test file write → recorded in session state
- [ ] Test runner: impl edit with failing test → pending failure stored
- [ ] Deferred blocking: pending failure → next `tool.execute.before` throws Error
- [ ] Clear on pass: passing test run → pending failure cleared
- [ ] `@opencode-ai/plugin` types — no TypeScript errors

### Cross-Platform

- [ ] Both platforms use identical test resolution logic (from shared core)
- [ ] Both platforms give identical TDD violation messages
- [ ] Session state isolation: Claude sessions don't interfere with OpenCode sessions
- [ ] `CLAUDE.md` updated with TDD protocol
- [ ] `.github/instructions/tdd.instructions.md` created
- [ ] `.github/copilot-instructions.md` table updated
- [ ] No lint-disable or ts-ignore comments in hook files
- [ ] `bun check` passes (hooks are `.mjs`, not linted by oxlint TypeScript rules)
