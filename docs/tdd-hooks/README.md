# TDD Enforcement for Claude Code

Hooks that enforce strict Red → Green → Refactor at the tool level.
The agent cannot bypass these — violations are blocked before the file write completes.

---

## File Structure

```
.claude/
├── settings.json          # Hook registration
├── SYSTEM_PROMPT.md       # Paste into Claude Code system prompt
└── hooks/
    ├── enforce-tdd.js               # PreToolUse:  block impl write without test
    ├── enforce-tdd-tracker.js       # PostToolUse: track test files written this session
    ├── snapshot-before-edit.js      # PreToolUse:  snapshot API surface + coverage
    ├── verify-tests-pass.js         # PostToolUse: run tests, block on red
    ├── verify-no-new-functionality.js  # PostToolUse: diff surface + coverage
    ├── mutation-snapshot.js         # PreToolUse:  snapshot surviving mutants (Stryker)
    └── mutation-verify.js           # PostToolUse: diff mutants, block on new survivors
```

---

## What Each Hook Enforces

| Hook                          | Phase            | Catches                                    |
| ----------------------------- | ---------------- | ------------------------------------------ |
| `enforce-tdd`                 | Red              | Impl write without test file               |
| `enforce-tdd-tracker`         | Red              | Records test files written this session    |
| `snapshot-before-edit`        | Refactor         | Baseline for surface + coverage diff       |
| `verify-tests-pass`           | Green + Refactor | Any test regression after an edit          |
| `verify-no-new-functionality` | Refactor         | New exports, new params, coverage drop     |
| `mutation-snapshot`           | Refactor         | Baseline surviving mutants before edit     |
| `mutation-verify`             | Refactor         | New surviving mutants = new untested logic |

---

## Setup

### 1. Install Stryker (for mutation testing)

```bash
npm install --save-dev @stryker-mutator/core @stryker-mutator/vitest-runner
```

### 2. Copy `.claude/` to your project root

```bash
cp -r .claude/ /your-project/.claude/
```

### 3. Make hooks executable

```bash
chmod +x .claude/hooks/*.js
```

### 4. Add system prompt

Copy the contents of `.claude/SYSTEM_PROMPT.md` into your Claude Code project system prompt.

---

## Tuning Mutation Testing Speed

Mutation testing runs Stryker twice per file edit (before + after), which takes 30–120s.

**Disable during rapid iteration:**

```bash
TDD_MUTATION=0 claude  # mutation checks skipped
```

**Re-enable for final verification:**

```bash
TDD_MUTATION=1 claude  # full enforcement (default)
```

---

## Extending for Other Test Runners

`verify-tests-pass.js` and `snapshot-before-edit.js` auto-detect Vitest and Jest.
To add Mocha or another runner, extend the `detectRunner()` function:

```js
if (fs.existsSync('.mocharc.js')) return `npx mocha ${testFile}`
```

For mutation testing with Jest instead of Vitest, swap the `testRunner` in the
Stryker config inside `mutation-snapshot.js` and `mutation-verify.js`:

```js
testRunner: "jest",   // instead of "vitest"
```

---

## False Positive Handling

Mutation testing uses **mutator name + replacement text** as identity (not line numbers),
so pure refactors that shift line numbers don't trigger false positives.

If you encounter a legitimate false positive (e.g. Stryker flakiness):

```bash
TDD_MUTATION=0 claude  # disable for this session
```
