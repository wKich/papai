# Rename Mock-Pollution to Test-Health and Add State Pollution Detection

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename the `check-mock-pollution.ts` script to `check-test-health.ts` to reflect its broader scope, and implement Pattern 4 detection for module-level mutable state pollution.

**Architecture:** Rename files and directory, update imports, add new AST-based detection for module-level `const`/`let` declarations that are mutable (Set, Map, Array, Object) and track whether they have reset functions or are cleaned up in tests.

**Tech Stack:** TypeScript, TypeScript compiler API (AST parsing), Bun

---

## Background

The current `check-mock-pollution.ts` script only detects `mock.module()` pollution patterns. However, the project has another class of test pollution issues: **module-level mutable state** that persists between tests. Examples include:

- `const stats = { totalMessages: 0, ... }` in `state-collector.ts`
- `const listeners = new Set<Listener>()` in `event-bus.ts`
- `const logBuffer = new LogRingBuffer()` in `log-buffer.ts`

These need detection and the script should be renamed to reflect its broader scope.

---

## Task 1: Rename Main Script File

**Files:**

- Rename: `scripts/check-mock-pollution.ts` → `scripts/check-test-health.ts`

**Step 1: Rename the file**

```bash
mv scripts/check-mock-pollution.ts scripts/check-test-health.ts
```

**Step 2: Update shebang and header comment**

Open `scripts/check-test-health.ts` and update the header:

```typescript
#!/usr/bin/env bun
/**
 * Test Health Analyzer
 *
 * Detects patterns that cause test pollution or flakiness:
 *
 * PATTERN 1 — Barrel mock: mocking a barrel file corrupts sub-module live bindings (HIGH)
 * PATTERN 2 — Shared module mocked without cleanup (MEDIUM)
 * PATTERN 3 — Transitive mock pollution (HIGH)
 * PATTERN 4 — Module-level mutable state not reset between tests (MEDIUM)
 *
 * Usage: bun run scripts/check-test-health.ts [--strict]
 */
```

**Step 3: Update import paths in the renamed file**

Change lines 23-24:

```typescript
// OLD:
import { findTransitiveImporters } from './check-mock-pollution/graph.js'
import { buildImportGraph } from './check-mock-pollution/scanner.js'

// NEW:
import { findTransitiveImporters } from './check-test-health/graph.js'
import { buildImportGraph } from './check-test-health/scanner.js'
```

**Step 4: Commit**

```bash
git add scripts/check-mock-pollution.ts scripts/check-test-health.ts
git commit -m "refactor: rename check-mock-pollution.ts to check-test-health.ts"
```

---

## Task 2: Rename Supporting Directory

**Files:**

- Rename directory: `scripts/check-mock-pollution/` → `scripts/check-test-health/`

**Step 1: Rename the directory**

```bash
mv scripts/check-mock-pollution scripts/check-test-health
```

**Step 2: Verify files are intact**

Directory should contain:

- `graph.ts` - unchanged
- `scanner.ts` - unchanged

**Step 3: Commit**

```bash
git add scripts/check-mock-pollution scripts/check-test-health
git commit -m "refactor: rename check-mock-pollution directory to check-test-health"
```

---

## Task 3: Update package.json Scripts

**Files:**

- Modify: `package.json:32`

**Step 1: Update the script entry**

Change line 32:

```json
// OLD:
"mock-pollution": "bun run scripts/check-mock-pollution.ts --strict",

// NEW:
"test-health": "bun run scripts/check-test-health.ts --strict",
```

**Step 2: Update check:verbose script**

Change line 29:

```json
// OLD:
"check:verbose": "bun run --parallel lint typecheck format:check knip test duplicates mock-pollution",

// NEW:
"check:verbose": "bun run --parallel lint typecheck format:check knip test duplicates test-health",
```

**Step 3: Commit**

```bash
git add package.json
git commit -m "refactor: update package.json scripts for test-health rename"
```

---

## Task 4: Implement Pattern 4 - Module-Level State Detection

**Files:**

- Modify: `scripts/check-test-health.ts`

**Step 1: Add helper functions for Pattern 4**

Add these functions after line 125 (after `rel` function):

```typescript
// ─── Pattern 4: Module-level state detection ──────────────────────────────────

/** Extract module-level const/let declarations with mutable initializers */
function extractModuleLevelState(sf: ts.SourceFile): Array<{ name: string; line: number; type: string }> {
  const results: Array<{ name: string; line: number; type: string }> = []
  const sourceText = sf.getFullText()

  function walk(node: ts.Node): void {
    // Only process top-level variable statements
    if (ts.isVariableStatement(node) && ts.isSourceFile(node.parent)) {
      const isConst = !!(node.declarationList.flags & ts.NodeFlags.Const)
      const isLet = !!(node.declarationList.flags & ts.NodeFlags.Let)

      if (!isConst && !isLet) return

      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue

        const name = decl.name.text
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1

        if (!decl.initializer) continue

        const initText = decl.initializer.getText(sourceText)
        let type = 'unknown'

        if (initText.includes('new Set')) type = 'Set'
        else if (initText.includes('new Map')) type = 'Map'
        else if (initText.includes('new WeakMap')) type = 'WeakMap'
        else if (initText.includes('new WeakSet')) type = 'WeakSet'
        else if (initText.startsWith('[')) type = 'Array'
        else if (initText.startsWith('{') && initText.includes(':')) type = 'Object'
        else if (initText.startsWith('Date.now')) type = 'Timestamp'

        if (type !== 'unknown') {
          results.push({ name, line, type })
        }
      }
    }
    ts.forEachChild(node, walk)
  }

  walk(sf)
  return results
}

/** Check if source file exports a reset/clear function for given state variable */
function hasResetFunction(sf: ts.SourceFile, stateVarName: string): boolean {
  let found = false
  const sourceText = sf.getFullText()

  function walk(node: ts.Node): void {
    if (found) return

    // Check exported function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      if (isExported && /reset|clear/i.test(node.name.text)) {
        const bodyText = node.getFullText(sourceText)
        if (bodyText.includes(stateVarName)) {
          found = true
          return
        }
      }
    }

    // Check exported variable declarations (function expressions)
    if (ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      if (isExported) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && /reset|clear/i.test(decl.name.text)) {
            const initText = decl.initializer?.getText(sourceText) ?? ''
            if (initText.includes(stateVarName)) {
              found = true
              return
            }
          }
        }
      }
    }

    ts.forEachChild(node, walk)
  }

  walk(sf)
  return found
}

/** Check if test file has beforeEach/afterEach cleanup */
function hasTestCleanup(sf: ts.SourceFile): boolean {
  let found = false

  function walk(node: ts.Node): void {
    if (found) return

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fnName = node.expression.text
      if (fnName === 'beforeEach' || fnName === 'afterEach') {
        // Check if callback contains reset-like calls
        if (node.arguments.length > 0) {
          const callback = node.arguments[0]
          if (callback) {
            const callbackText = callback.getText(sf.getFullText())
            if (/reset|clear|mock\.restore/i.test(callbackText)) {
              found = true
              return
            }
          }
        }
      }
    }

    ts.forEachChild(node, walk)
  }

  walk(sf)
  return found
}

/** Check if a specific state variable is referenced in cleanup */
function stateHasCleanup(sf: ts.SourceFile, stateVarName: string): boolean {
  function walk(node: ts.Node): boolean {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fnName = node.expression.text
      if (fnName === 'beforeEach' || fnName === 'afterEach') {
        const callback = node.arguments[0]
        if (callback) {
          const callbackText = callback.getText(sf.getFullText())
          if (callbackText.includes(stateVarName)) {
            return true
          }
        }
      }
    }
    return ts.forEachChild(node, walk) ?? false
  }

  return walk(sf) ?? false
}
```

**Step 2: Add Pattern 4 detection logic**

Add Pattern 4 detection after Pattern 3 (after line 253), before the Report section:

```typescript
// Pattern 4: Module-level mutable state not reset between tests
const SOURCE_FILES_WITH_STATE = files.filter((f) => f.path.includes('/src/') && !f.path.endsWith('.test.ts'))
const TEST_FILES = files.filter((f) => f.path.endsWith('.test.ts'))

for (const sourceFile of SOURCE_FILES_WITH_STATE) {
  const sf = parseSource(sourceFile.path)
  const mutableState = extractModuleLevelState(sf)

  if (mutableState.length === 0) continue

  // Find test files that import this source file (directly or transitively)
  const importingTests: Array<{ file: FileInfo; hasCleanup: boolean }> = []

  for (const testFile of TEST_FILES) {
    if (testFile.imports.includes(sourceFile.path)) {
      const testSf = parseSource(testFile.path)
      importingTests.push({
        file: testFile,
        hasCleanup: hasTestCleanup(testSf),
      })
    } else {
      // Check transitive imports
      const transitive = findTransitiveImporters(sourceFile.path, importGraph)
      if (transitive.includes(testFile.path)) {
        const testSf = parseSource(testFile.path)
        importingTests.push({
          file: testFile,
          hasCleanup: hasTestCleanup(testSf),
        })
      }
    }
  }

  if (importingTests.length === 0) continue

  for (const state of mutableState) {
    // Skip if there's a reset function for this state
    if (hasResetFunction(sf, state.name)) continue

    // Check if any importing test cleans up this specific state
    const hasStateSpecificCleanup = importingTests.some((test) => {
      const testSf = parseSource(test.file.path)
      return stateHasCleanup(testSf, state.name)
    })

    // Skip if there's general cleanup OR state-specific cleanup
    const hasAnyCleanup = importingTests.some((t) => t.hasCleanup)
    if (hasAnyCleanup || hasStateSpecificCleanup) continue

    issues.push({
      severity: 'MEDIUM',
      lines: [
        `  [MEDIUM] Module-level mutable state not reset between tests`,
        `  File   : ${rel(sourceFile.path)}`,
        `  State  : ${state.name} (${state.type}) at line ${state.line}`,
        `  Tests  : ${importingTests.map((t) => rel(t.file.path)).join(', ')}`,
        `  Fix    : Export reset${state.name.charAt(0).toUpperCase() + state.name.slice(1)}() and call in beforeEach/afterEach,`,
        `           or add mock.restore() cleanup if module is mocked`,
      ],
    })
  }
}
```

**Step 3: Commit**

```bash
git add scripts/check-test-health.ts
git commit -m "feat: add Pattern 4 detection for module-level mutable state"
```

---

## Task 5: Test the Enhanced Script

**Files:**

- Run: `scripts/check-test-health.ts`

**Step 1: Run the renamed script**

```bash
bun run scripts/check-test-health.ts --strict
```

**Expected Output:**
Should detect the state-collector.ts stats issue:

```
⚠  1 test health warning(s) (run with --strict to fail on these):

  [MEDIUM] Module-level mutable state not reset between tests
  File   : src/debug/state-collector.ts
  State  : stats (Object) at line 13
  Tests  : tests/debug/state-collector.test.ts
  Fix    : Export resetStats() and call in beforeEach/afterEach,
           or add mock.restore() cleanup if module is mocked
```

**Step 2: Verify no HIGH severity issues**

Ensure existing patterns still work correctly.

**Step 3: Test with --strict flag**

```bash
bun run scripts/check-test-health.ts --strict
```

Should exit with code 1 if any issues found.

---

## Task 6: Run Full Verification

**Files:**

- Run: `check:verbose` script

**Step 1: Run all checks**

```bash
bun run check:verbose
```

**Expected:** All checks pass, including the renamed `test-health` check.

**Step 2: Verify package.json scripts work**

```bash
bun run test-health
```

---

## Success Criteria

- [ ] Script renamed from `check-mock-pollution.ts` to `check-test-health.ts`
- [ ] Directory renamed from `check-mock-pollution/` to `check-test-health/`
- [ ] All imports updated to use new paths
- [ ] `package.json` scripts updated (`test-health` instead of `mock-pollution`)
- [ ] Pattern 4 detection implemented and working
- [ ] Script detects `stats` object in `state-collector.ts` as MEDIUM severity issue
- [ ] All existing patterns (1-3) still work correctly
- [ ] `bun run check:verbose` passes
