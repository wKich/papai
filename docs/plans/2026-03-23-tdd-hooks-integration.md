# TDD Hooks Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Use @test-driven-development skill for all code changes.

**Goal:** Integrate prototype TDD enforcement hooks from `docs/tdd-hooks/` into the project's
`.claude/` hooks system so that Claude Code is mechanically prevented from writing
implementation code without tests, and cannot regress existing tests during refactoring.

**Source:** `docs/tdd-hooks/` (7 hook scripts + README + SYSTEM_PROMPT + settings.json)

**Target:** `.claude/hooks/` (committed to repo, available to all contributors)

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
| Code duplication    | `extractSurface()` in 2 files    | —                                                   | Extract shared utility                         |

### What Works As-Is

- Session state files in `/tmp/tdd-session-*` pattern
- Concept of tracking test files written per session
- Refactor guards (new exports, new params detection)
- Mutation testing survivor diffing logic

---

## Decision: Scope of Integration

### Phase 1 — Core TDD Gate (this plan)

**In scope:**

1. `enforce-tdd.js` — block impl writes without test (PreToolUse)
2. `enforce-tdd-tracker.js` — track test files written in session (PostToolUse)
3. `verify-tests-pass.js` — run tests after impl edit, block on red (PostToolUse)
4. Settings merge into `.claude/settings.json` (shared, committed to repo)
5. System prompt additions to `CLAUDE.md`

**Out of scope (Phase 2):**

- `snapshot-before-edit.js` + `verify-no-new-functionality.js` (refactor guards)
- `mutation-snapshot.js` + `mutation-verify.js` (mutation testing hooks)
- These require coverage infrastructure changes and add 30-120s per edit

### Rationale

The core TDD gate (hooks 1-3) provides 80% of the value: it prevents writing
implementation without tests and catches regressions immediately. The refactor guards
and mutation hooks add latency (coverage + Stryker runs) and require more complex
infrastructure adaptation. They can be layered on once the core hooks are proven stable.

---

## Architecture

```
.claude/
├── settings.json                # NEW: TDD hook registration (shared, committed)
├── settings.local.json          # Existing: permissions + Stop hook (local only)
└── hooks/
    ├── check-no-lint-suppression.sh   # Existing Stop hook
    ├── enforce-tdd.mjs                # NEW: PreToolUse — block impl without test
    ├── enforce-tdd-tracker.mjs        # NEW: PostToolUse — track test files
    └── verify-tests-pass.mjs          # NEW: PostToolUse — run tests, block on red
```

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

### Hook Execution Environment

Claude Code runs hooks via the **system shell** (bash/zsh), not Node.js directly. Hook commands
in `settings.json` are shell commands — to run a `.mjs` file, the command must explicitly invoke
`node`. Since the project uses ESM (`"type": "module"` in package.json), Node.js handles
`import` syntax natively. The `.mjs` extension forces ESM regardless of `package.json`.

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

### Task 1: Create `enforce-tdd.mjs` — PreToolUse hook

**Files:** Create `.claude/hooks/enforce-tdd.mjs`

**What it does:** Before any `Write` or `Edit` tool call on an implementation file, checks that
a corresponding test file exists (either on disk or written earlier in the session). Blocks the
tool call if no test file found.

**Key adaptations from prototype:**

- Fix test file resolution to use `tests/` parallel directory
- Fix PreToolUse output to use `hookSpecificOutput.permissionDecision: "deny"` format
- Fix tool input field to use `tool_input.file_path` (not `tool_input.path`)
- Add project root resolution via `cwd` from input JSON

**Implementation outline:**

```javascript
// PreToolUse — enforce TDD: tests must exist before implementation

import fs from 'node:fs'
import path from 'node:path'

const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
const { tool_name, tool_input, session_id, cwd } = input

// Only gate Write and Edit tools
if (tool_name !== 'Write' && tool_name !== 'Edit') process.exit(0)

const filePath = tool_input.file_path
if (!filePath) process.exit(0)

const IMPL_PATTERN = /\.(?:ts|js|tsx|jsx)$/
const TEST_PATTERN = /\.(?:test|spec)\.(?:ts|js|tsx|jsx)$/

// Allow test file writes unconditionally
if (TEST_PATTERN.test(filePath)) process.exit(0)
// Only gate implementation files
if (!IMPL_PATTERN.test(filePath)) process.exit(0)

// Resolve paths relative to project root
const projectRoot = cwd
const relPath = path.relative(projectRoot, filePath)

// Skip files outside src/
if (!relPath.startsWith('src/')) process.exit(0)

function findTestFile(implAbsPath) {
  const rel = path.relative(projectRoot, implAbsPath)
  // src/foo/bar.ts → tests/foo/bar.test.ts
  const testRel = rel.replace(/^src\//, 'tests/').replace(/\.([tj]sx?)$/, '.test.$1')
  const testAbs = path.join(projectRoot, testRel)
  if (fs.existsSync(testAbs)) return testAbs

  // Fallback: colocated test
  const dir = path.dirname(implAbsPath)
  const ext = path.extname(implAbsPath)
  const base = path.basename(implAbsPath, ext)
  const colocated = path.join(dir, `${base}.test${ext}`)
  if (fs.existsSync(colocated)) return colocated

  return null
}

// Check session state for tests written this session
const STATE_FILE = `/tmp/tdd-session-${session_id}.json`
function loadSessionState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return { writtenTests: [] }
  }
}

const state = loadSessionState()
const absPath = path.resolve(filePath)
const baseName = path.basename(absPath, path.extname(absPath))
const alreadyTestedThisSession = state.writtenTests.some(
  (t) => path.basename(t, path.extname(t)).replace(/\.(test|spec)$/, '') === baseName,
)

if (findTestFile(absPath) || alreadyTestedThisSession) process.exit(0)

// Suggest the expected test file path
const suggestedTest = relPath.replace(/^src\//, 'tests/').replace(/\.([tj]sx?)$/, '.test.$1')

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

**Verification:**

```bash
# Create a temp test to verify the hook works
echo '{"tool_name":"Write","tool_input":{"file_path":"/Users/ki/Projects/experiments/papai/src/config.ts","content":"x"},"session_id":"test","cwd":"/Users/ki/Projects/experiments/papai","hook_event_name":"PreToolUse"}' | node .claude/hooks/enforce-tdd.mjs
# Expected: exit 0 (test exists at tests/config.test.ts)

echo '{"tool_name":"Write","tool_input":{"file_path":"/Users/ki/Projects/experiments/papai/src/nonexistent-module.ts","content":"x"},"session_id":"test","cwd":"/Users/ki/Projects/experiments/papai","hook_event_name":"PreToolUse"}' | node .claude/hooks/enforce-tdd.mjs
# Expected: JSON with permissionDecision: "deny"
```

**Commit:** `feat: add enforce-tdd hook for TDD gate`

---

### Task 2: Create `enforce-tdd-tracker.mjs` — PostToolUse hook

**Files:** Create `.claude/hooks/enforce-tdd-tracker.mjs`

**What it does:** After any `Write` or `Edit` of a test file, records the test file path in the
session state file. This lets `enforce-tdd.mjs` know that a test was written this session even
if it hasn't been saved to disk in the expected location yet.

**Implementation outline:**

```javascript
// PostToolUse — record when a test file is written this session

import fs from 'node:fs'
import path from 'node:path'

const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
const { tool_name, tool_input, session_id } = input

if (tool_name !== 'Write' && tool_name !== 'Edit') process.exit(0)

const filePath = tool_input.file_path
const TEST_PATTERN = /\.(?:test|spec)\.(?:ts|js|tsx|jsx)$/
if (!filePath || !TEST_PATTERN.test(filePath)) process.exit(0)

const STATE_FILE = `/tmp/tdd-session-${session_id}.json`
let state = { writtenTests: [] }
try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
} catch {}

const absPath = path.resolve(filePath)
if (!state.writtenTests.includes(absPath)) {
  state.writtenTests.push(absPath)
  fs.writeFileSync(STATE_FILE, JSON.stringify(state))
}

process.exit(0)
```

**Verification:**

```bash
echo '{"tool_name":"Write","tool_input":{"file_path":"/tmp/foo.test.ts","content":"x"},"session_id":"test123","cwd":"/tmp","hook_event_name":"PostToolUse","tool_response":{"success":true}}' | node .claude/hooks/enforce-tdd-tracker.mjs
cat /tmp/tdd-session-test123.json
# Expected: {"writtenTests":["/tmp/foo.test.ts"]}
rm -f /tmp/tdd-session-test123.json
```

**Commit:** `feat: add enforce-tdd-tracker hook for session state`

---

### Task 3: Create `verify-tests-pass.mjs` — PostToolUse hook

**Files:** Create `.claude/hooks/verify-tests-pass.mjs`

**What it does:** After any impl file write, finds the corresponding test file and runs it with
`bun test`. If tests fail, outputs a `decision: "block"` response so Claude gets the error
feedback.

**Key adaptations from prototype:**

- Use Bun test runner instead of Vitest/Jest detection
- Use `tests/` parallel directory resolution
- PostToolUse `decision: "block"` format (correct as-is for PostToolUse)
- Also run for test file edits (catch broken tests immediately)

**Implementation outline:**

```javascript
// PostToolUse — after every file write, run related tests.
// If tests fail, block the agent so it must fix before proceeding.

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
const { tool_name, tool_input, cwd } = input

if (tool_name !== 'Write' && tool_name !== 'Edit') process.exit(0)

const filePath = tool_input.file_path
if (!filePath) process.exit(0)

const IMPL_PATTERN = /\.(?:ts|js|tsx|jsx)$/
const TEST_PATTERN = /\.(?:test|spec)\.(?:ts|js|tsx|jsx)$/

if (!IMPL_PATTERN.test(filePath)) process.exit(0)

const projectRoot = cwd

function findTestFile(implAbsPath) {
  // If the file IS a test file, run it directly
  if (TEST_PATTERN.test(implAbsPath)) return implAbsPath

  const rel = path.relative(projectRoot, implAbsPath)

  // src/foo/bar.ts → tests/foo/bar.test.ts
  if (rel.startsWith('src/')) {
    const testRel = rel.replace(/^src\//, 'tests/').replace(/\.([tj]sx?)$/, '.test.$1')
    const testAbs = path.join(projectRoot, testRel)
    if (fs.existsSync(testAbs)) return testAbs
  }

  // Fallback: colocated
  const dir = path.dirname(implAbsPath)
  const ext = path.extname(implAbsPath)
  const base = path.basename(implAbsPath, ext)
  const colocated = path.join(dir, `${base}.test${ext}`)
  if (fs.existsSync(colocated)) return colocated

  return null
}

const absPath = path.resolve(filePath)
const testFile = findTestFile(absPath)
if (!testFile) process.exit(0)

let output = ''
let passed = true

try {
  output = execSync(`bun test ${testFile}`, {
    encoding: 'utf8',
    stdio: 'pipe',
    cwd: projectRoot,
    timeout: 30_000,
  })
} catch (err) {
  passed = false
  output = (err.stdout ?? '') + '\n' + (err.stderr ?? '')
}

if (!passed) {
  const relFile = path.relative(projectRoot, filePath)
  console.log(
    JSON.stringify({
      decision: 'block',
      reason:
        `Tests are RED after your edit of \`${relFile}\`.\n\n` +
        `You must fix the failing tests before proceeding.\n\n` +
        `── Test output ──────────────────────────────\n` +
        `${output.slice(0, 3000)}\n` +
        `─────────────────────────────────────────────\n\n` +
        `Fix the regression, then re-attempt.`,
    }),
  )
}

process.exit(0)
```

**Verification:**

```bash
# Test with a file that has passing tests
echo '{"tool_name":"Edit","tool_input":{"file_path":"/Users/ki/Projects/experiments/papai/src/config.ts","old_string":"x","new_string":"y"},"session_id":"test","cwd":"/Users/ki/Projects/experiments/papai","hook_event_name":"PostToolUse","tool_response":{"success":true}}' | node .claude/hooks/verify-tests-pass.mjs
# Expected: exit 0 with no output (tests pass)
```

**Commit:** `feat: add verify-tests-pass hook for test regression gate`

---

### Task 4: Merge hook registration into settings

**Files:** Create or modify `.claude/settings.json` (shared, committed to repo)

TDD hooks must go in `.claude/settings.json` (not `settings.local.json`) so they are committed
to the repo and available to all contributors. The existing `settings.local.json` retains
permissions and the Stop hook (local-only concerns).

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

Note: The existing Stop hook in `settings.local.json` is unaffected. Claude Code merges
both files (local takes precedence), so both hook sets will be active.

**Verification:**

```bash
# Verify JSON is valid
node -e "console.log(JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8')))"
# Check hooks load in Claude Code
claude --debug  # inspect hook registration output
```

**Commit:** `feat: register TDD hooks in settings.json`

---

### Task 5: Add TDD enforcement protocol to CLAUDE.md

**Files:** Modify `CLAUDE.md`

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

**Commit:** `docs: add TDD enforcement protocol to CLAUDE.md`

---

### Task 6: Verify end-to-end

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
   # Create a deliberately failing test, verify hook catches it
   echo '{"tool_name":"Write","tool_input":{"file_path":"'$PWD'/src/errors.ts","content":"x"},"session_id":"e2e","cwd":"'$PWD'","hook_event_name":"PostToolUse","tool_response":{"success":true}}' | node .claude/hooks/verify-tests-pass.mjs
   # Should exit 0 with no output (tests/errors.test.ts passes)
   ```

**Commit:** `test: verify TDD hooks end-to-end`

---

### Task 7: Clean up prototype docs

**Files:** No file changes — just document the relationship.

Add a note to `docs/tdd-hooks/README.md`:

```markdown
---

## Status

This directory contains the **prototype** hooks. The production-ready, project-adapted
versions live in `.claude/hooks/`. Key differences:

- Uses Bun test runner instead of Vitest/Jest
- Resolves test files in `tests/` parallel directory (not colocated)
- Uses correct Claude Code hook output format (`hookSpecificOutput.permissionDecision`)
- Scoped to `src/**/*.ts` files only
```

**Commit:** `docs: note prototype vs production hook locations`

---

## Risk Assessment Matrix

| Risk                                          | Probability | Impact | Mitigation                                                                                   | Owner |
| --------------------------------------------- | ----------- | ------ | -------------------------------------------------------------------------------------------- | ----- |
| Hook blocks legitimate edits (false positive) | Medium      | High   | Only gate `src/` files; allow config/docs freely. Remove hooks from settings as escape hatch | Dev   |
| Test runner timeout slows Claude              | Medium      | Medium | 30s timeout on `bun test` per file; Bun is fast; test only the related file, not full suite  | Dev   |
| Hook crashes on malformed JSON                | Low         | Medium | Wrap stdin parsing in try/catch, exit 0 on error (fail open)                                 | Dev   |
| Session state file races (parallel hooks)     | Low         | Low    | PostToolUse hooks run sequentially per Claude Code docs                                      | Dev   |
| Node.js ESM resolution fails in hook          | Low         | High   | Use `.mjs` extension which forces ESM regardless of package.json; verify on setup            | Dev   |

---

## Phase 2 — Refactor Guards (future)

When Phase 1 is stable, add:

### Refactor Guard Hooks

1. **`snapshot-before-edit.mjs`** — PreToolUse: snapshot public API surface before edit
2. **`verify-no-new-functionality.mjs`** — PostToolUse: compare surface, block new exports/params

**Adaptations needed:**

- Replace Vitest coverage with `bun test --coverage` (Bun outputs lcov, not istanbul JSON)
- Parse Bun's coverage output format for statement coverage
- Extract shared `extractSurface()` to `.claude/hooks/lib/surface.mjs`

### Mutation Testing Hooks

3. **`mutation-snapshot.mjs`** — PreToolUse: run Stryker, snapshot survivors
4. **`mutation-verify.mjs`** — PostToolUse: diff survivors, block on new

**Adaptations needed:**

- Use project's existing `stryker.config.json` with `testRunner: "bun"`
- Use `@hughescr/stryker-bun-runner` (already installed)
- Add `TDD_MUTATION` env var toggle
- Expect 30-120s per hook pair — only enable for final verification

---

## Quality Gate Checklist

- [ ] All 3 hooks created in `.claude/hooks/` (`.mjs` extension)
- [ ] `.claude/settings.json` created with PreToolUse and PostToolUse registrations
- [ ] Existing `Stop` hook in `settings.local.json` preserved (unmodified)
- [ ] Manual verification: impl write without test → blocked
- [ ] Manual verification: impl write with test → allowed
- [ ] Manual verification: test write + then impl write → allowed via session tracking
- [ ] Manual verification: edit that breaks test → blocked with test output
- [ ] `CLAUDE.md` updated with TDD protocol
- [ ] No lint-disable or ts-ignore comments in hook files
- [ ] `bun check` passes (hooks are `.mjs`, not linted by oxlint TypeScript rules)
