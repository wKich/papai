# Mock Pollution Detection Enhancement Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the gap in `scripts/check-mock-pollution.ts` where it fails to detect transitive mock pollution through module dependency chains.

**Architecture:** Extend the mock pollution script to build a complete source file dependency graph, trace transitive imports from mocks to victims, and report indirect pollution risks. The script will now scan both test files AND source files to understand the full module graph.

**Tech Stack:** TypeScript, Bun runtime, TypeScript compiler API (ts.createSourceFile), Bun.Glob for file discovery

---

## Background

The current `scripts/check-mock-pollution.ts` script only detects **direct** mock pollution:

- Pattern 1: Barrel file mocks that corrupt sub-module bindings
- Pattern 2: Shared modules mocked without cleanup

It **misses** transitive pollution where:

1. `test-A.ts` mocks `src/db/drizzle.js`
2. `test-B.ts` imports `src/poller.ts`
3. `src/poller.ts` imports `src/background-events.ts`
4. `src/background-events.ts` imports `src/db/drizzle.js` (the mocked module)

When test-B runs after test-A, the mock from test-A pollutes test-B through the dependency chain, but the script doesn't detect this because it only looks at direct imports.

---

## Prerequisites

Read these files to understand the codebase:

- `CLAUDE.md` - Project overview and testing guidelines
- `scripts/check-mock-pollution.ts` - Current implementation (lines 1-299)
- `tests/scripts/check-mock-pollution.test.ts` - Existing tests for the script

---

## Task 1: Create Transitive Import Detection Infrastructure

**Files:**

- Create: `scripts/check-mock-pollution/graph.ts`
- Test: `tests/scripts/check-mock-pollution/graph.test.ts`

**Step 1: Write failing test for transitive import detection**

```typescript
import { describe, expect, test } from 'bun:test'
import { findTransitiveImporters } from '../../../scripts/check-mock-pollution/graph.js'

describe('findTransitiveImporters', () => {
  test('finds direct importers', () => {
    const importGraph = new Map([['/src/db/drizzle.ts', ['/src/config.ts', '/src/background-events.ts']]])

    const result = findTransitiveImporters('/src/db/drizzle.ts', importGraph)

    expect(result).toContain('/src/config.ts')
    expect(result).toContain('/src/background-events.ts')
  })

  test('finds transitive importers through chain', () => {
    const importGraph = new Map([
      ['/src/db/drizzle.ts', ['/src/background-events.ts']],
      ['/src/background-events.ts', ['/src/poller.ts']],
      ['/src/poller.ts', ['/tests/poller.test.ts']],
    ])

    const result = findTransitiveImporters('/src/db/drizzle.ts', importGraph)

    expect(result).toContain('/src/background-events.ts')
    expect(result).toContain('/src/poller.ts')
    expect(result).toContain('/tests/poller.test.ts')
  })

  test('handles cycles without infinite loop', () => {
    const importGraph = new Map([
      ['/src/a.ts', ['/src/b.ts']],
      ['/src/b.ts', ['/src/c.ts']],
      ['/src/c.ts', ['/src/a.ts']], // cycle
    ])

    const result = findTransitiveImporters('/src/a.ts', importGraph)

    expect(result).toContain('/src/b.ts')
    expect(result).toContain('/src/c.ts')
    expect(result).toHaveLength(2) // no duplicates from cycle
  })

  test('returns empty array for module with no importers', () => {
    const importGraph = new Map([['/src/db/drizzle.ts', []]])

    const result = findTransitiveImporters('/src/db/drizzle.ts', importGraph)

    expect(result).toEqual([])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/check-mock-pollution/graph.test.ts`

Expected: FAIL with "Module not found" or similar

**Step 3: Implement transitive import finder**

Create `scripts/check-mock-pollution/graph.ts`:

```typescript
/**
 * Find all files that transitively import a given module.
 *
 * @param modulePath - The module to find importers for
 * @param importGraph - Map of module -> array of modules that directly import it
 * @returns Array of all files (direct and transitive) that import the module
 */
export function findTransitiveImporters(modulePath: string, importGraph: Map<string, string[]>): string[] {
  const result: string[] = []
  const visited = new Set<string>()
  const queue: string[] = [modulePath]

  while (queue.length > 0) {
    const current = queue.shift()!

    if (visited.has(current)) {
      continue
    }
    visited.add(current)

    // Get files that directly import current
    const directImporters = importGraph.get(current) ?? []

    for (const importer of directImporters) {
      if (!visited.has(importer)) {
        result.push(importer)
        queue.push(importer)
      }
    }
  }

  return result
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/check-mock-pollution/graph.test.ts`

Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add scripts/check-mock-pollution/graph.ts tests/scripts/check-mock-pollution/graph.test.ts
git commit -m "feat: add transitive import detection for mock pollution"
```

---

## Task 2: Build Complete Import Graph from Source Files

**Files:**

- Create: `scripts/check-mock-pollution/scanner.ts`
- Modify: `scripts/check-mock-pollution.ts` (refactor to use new module)
- Test: `tests/scripts/check-mock-pollution/scanner.test.ts`

**Step 1: Write failing test for import graph builder**

```typescript
import { describe, expect, test } from 'bun:test'
import { buildImportGraph } from '../../../scripts/check-mock-pollution/scanner.js'

describe('buildImportGraph', () => {
  test('builds graph from test file importing source file', () => {
    // This is a simplified test - in reality we'd need temp files
    const files = [
      {
        path: '/tests/poller.test.ts',
        imports: ['../src/poller.ts'],
      },
      {
        path: '/src/poller.ts',
        imports: ['./background-events.ts'],
      },
      {
        path: '/src/background-events.ts',
        imports: ['./db/drizzle.ts'],
      },
    ]

    const graph = buildImportGraph(files)

    // Graph should map module -> files that import it
    expect(graph.get('/src/poller.ts')).toContain('/tests/poller.test.ts')
    expect(graph.get('/src/background-events.ts')).toContain('/src/poller.ts')
    expect(graph.get('/src/db/drizzle.ts')).toContain('/src/background-events.ts')
  })

  test('handles unresolved imports gracefully', () => {
    const files = [
      {
        path: '/tests/test.ts',
        imports: ['external-package'], // won't resolve
      },
    ]

    const graph = buildImportGraph(files)

    // External packages shouldn't be in graph
    expect(graph.has('external-package')).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/check-mock-pollution/scanner.test.ts`

Expected: FAIL with module not found

**Step 3: Implement scanner module**

Create `scripts/check-mock-pollution/scanner.ts`:

```typescript
import { existsSync, readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import ts from 'typescript'

/**
 * Extract imports from a TypeScript source file.
 */
export function extractImportsFromSource(filePath: string, sourceText: string): string[] {
  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)
  const imports: string[] = []

  function walk(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      // Skip type-only imports
      if (node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword) return

      const { moduleSpecifier } = node
      if (!ts.isStringLiteral(moduleSpecifier)) return

      const resolved = resolveImportSpecifier(filePath, moduleSpecifier.text)
      if (resolved) {
        imports.push(resolved)
      }
    }
    ts.forEachChild(node, walk)
  }

  walk(sf)
  return imports
}

/**
 * Resolve an import specifier to an absolute path.
 */
function resolveImportSpecifier(fromFile: string, specifier: string): string | null {
  // External packages - skip
  if (!specifier.startsWith('.')) return null

  const fromDir = dirname(fromFile)
  const base = resolve(fromDir, specifier)

  // Try common TypeScript extensions
  const candidates = [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}/index.ts`]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

/**
 * Build import graph: module -> array of files that import it
 */
export function buildImportGraph(files: Array<{ path: string; imports: string[] }>): Map<string, string[]> {
  const graph = new Map<string, string[]>()

  for (const file of files) {
    for (const importedModule of file.imports) {
      if (!graph.has(importedModule)) {
        graph.set(importedModule, [])
      }
      graph.get(importedModule)!.push(file.path)
    }
  }

  return graph
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/check-mock-pollution/scanner.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add scripts/check-mock-pollution/scanner.ts tests/scripts/check-mock-pollution/scanner.test.ts
git commit -m "feat: add source file scanner for import graph building"
```

---

## Task 3: Add Transitive Mock Pollution Detection Pattern

**Files:**

- Modify: `scripts/check-mock-pollution.ts` (lines 248-271)
- Test: `tests/scripts/check-mock-pollution.test.ts`

**Step 1: Write failing test for transitive detection**

Add to `tests/scripts/check-mock-pollution.test.ts`:

```typescript
describe('transitive mock pollution detection', () => {
  test('detects when mock affects test through transitive imports', async () => {
    // Create temporary test structure
    const testDir = '/tmp/mock-pollution-test'

    // Write test files
    await Bun.write(
      `${testDir}/tests/test-a.test.ts`,
      `
import { afterAll, mock, test } from 'bun:test'
void mock.module('../src/db/drizzle.js', () => ({ getDrizzleDb: () => null }))
afterAll(() => { mock.restore() })
test('dummy', () => {})
`,
    )

    await Bun.write(
      `${testDir}/tests/test-b.test.ts`,
      `
import { test } from 'bun:test'
import { pollScheduledOnce } from '../src/poller.js'
test('poll', () => {})
`,
    )

    await Bun.write(
      `${testDir}/src/poller.ts`,
      `
import { recordBackgroundEvent } from './background-events.js'
export function pollScheduledOnce() {}
`,
    )

    await Bun.write(
      `${testDir}/src/background-events.ts`,
      `
import { getDrizzleDb } from './db/drizzle.js'
export function recordBackgroundEvent() {}
`,
    )

    await Bun.write(
      `${testDir}/src/db/drizzle.ts`,
      `
export function getDrizzleDb() {}
`,
    )

    // Run check-mock-pollution
    const result = await runCheckMockPollution(testDir)

    // Should detect that test-b is affected by the mock in test-a
    expect(result.output).toContain('test-b.test.ts')
    expect(result.output).toContain('transitive')
    expect(result.exitCode).toBe(1)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/check-mock-pollution.test.ts -t "transitive"`

Expected: FAIL - current script doesn't detect this

**Step 3: Implement transitive pollution detection**

Modify `scripts/check-mock-pollution.ts`:

Add imports at top:

```typescript
import { findTransitiveImporters } from './check-mock-pollution/graph.js'
import { buildImportGraph, extractImportsFromSource } from './check-mock-pollution/scanner.js'
```

Replace lines 186-212 (file scanning) with:

```typescript
// Scan BOTH test files and source files to build complete import graph
const allFiles: string[] = [
  ...unitTests,
  // Find all source files
  ...(await Array.fromAsync(new Bun.Glob('src/**/*.ts').scan({ cwd: ROOT }))).map((f) => resolve(ROOT, f)),
]

const files: FileInfo[] = allFiles.map((filePath) => {
  const sf = parseSource(filePath)
  return {
    path: filePath,
    mocks: extractMocks(sf, filePath),
    imports: extractImports(sf, filePath),
    hasCleanup: hasRestoreCleanup(sf),
  }
})

// Build reverse import graph: module -> files that import it
const importGraphData = files.map((f) => ({ path: f.path, imports: f.imports }))
const importGraph = buildImportGraph(importGraphData)

// Build indexes: module → files that mock/import it
const mockedBy = new Map<string, string[]>()
const mockerHasCleanup = new Map<string, boolean>()

for (const file of files) {
  for (const mod of file.mocks) {
    if (!mockedBy.has(mod)) mockedBy.set(mod, [])
    mockedBy.get(mod)!.push(file.path)
    mockerHasCleanup.set(file.path, file.hasCleanup)
  }
}
```

Add new Pattern 3 after line 271:

```typescript
// ─── Pattern 3: Transitive mock pollution ────────────────────────────────────

for (const [mockedModule, mockers] of mockedBy) {
  if (SAFE_TO_MOCK.some((s) => mockedModule.endsWith(s))) continue

  // Find ALL files that transitively import this mocked module
  const transitiveImporters = findTransitiveImporters(mockedModule, importGraph)

  // Filter to only test files that are NOT the mockers themselves
  const affectedTestFiles = transitiveImporters.filter((f) => {
    const isTestFile = f.endsWith('.test.ts')
    const isMocker = mockers.includes(f)
    return isTestFile && !isMocker
  })

  if (affectedTestFiles.length === 0) continue

  for (const mocker of mockers) {
    // Check if the mocker file has proper cleanup
    if (mockerHasCleanup.get(mocker) === true) continue

    issues.push({
      severity: 'HIGH',
      lines: [
        `  [HIGH] Transitive mock pollution detected`,
        `  Mocker : ${rel(mocker)}`,
        `  Module : ${rel(mockedModule)}`,
        `  Victims: ${affectedTestFiles.map(rel).join(', ')}`,
        `  Path   : ${rel(mockedModule)} → ... → ${affectedTestFiles.map(rel).join(', ')}`,
        `  Fix    : add afterAll(() => { mock.restore() }) to ${rel(mocker)}`,
      ],
    })
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/check-mock-pollution.test.ts -t "transitive"`

Expected: PASS

**Step 5: Verify with real codebase**

Run: `bun run scripts/check-mock-pollution.ts`

Expected: Should now detect the transitive pollution between:

- `background-events.test.ts` (mocks db/drizzle.js)
- `poller.test.ts` (affected through import chain)

**Step 6: Commit**

```bash
git add scripts/check-mock-pollution.ts scripts/check-mock-pollution/graph.ts scripts/check-mock-pollution/scanner.ts tests/scripts/check-mock-pollution.test.ts
git commit -m "feat: add transitive mock pollution detection"
```

---

## Task 4: Fix the Real Pollution Issues Found

**Files:**

- Modify: `tests/deferred-prompts/background-events.test.ts` (line 46-48)
- Modify: `tests/deferred-prompts/poller.test.ts` (line 43-45)
- Check: `tests/config.test.ts` and others mocking db/drizzle.js

**Step 1: Add mock.restore() afterEach instead of afterAll**

For `background-events.test.ts`, change:

```typescript
// BEFORE (line 45-48):
beforeEach(setupDb)
afterAll(() => {
  mock.restore()
})

// AFTER:
beforeEach(setupDb)
afterEach(() => {
  mock.restore() // Clean up after EACH test to prevent cross-file pollution
})
afterAll(() => {
  mock.restore() // Final cleanup
})
```

Do the same for `poller.test.ts` (lines 43-45).

**Step 2: Verify all tests still pass**

Run: `bun test tests/deferred-prompts/`

Expected: All tests pass, no pollution errors

**Step 3: Run full test suite**

Run: `bun test`

Expected: Pass rate improves (currently 19 failures due to pollution)

**Step 4: Commit**

```bash
git add tests/deferred-prompts/background-events.test.ts tests/deferred-prompts/poller.test.ts
git commit -m "fix: add afterEach mock.restore to prevent transitive pollution"
```

---

## Task 5: Update Documentation

**Files:**

- Modify: `CLAUDE.md` (lines 341-345 - testing section)

**Step 1: Update testing guidelines**

Find the section about mock pollution prevention and add:

````markdown
#### Rule 6: Use afterEach for mock cleanup, not just afterAll

When mocking shared modules (db/drizzle.js, config.js, etc.), always restore mocks
in `afterEach`, not just `afterAll`. This prevents transitive mock pollution where
one test file's mock affects another test file that imports from the mocked module
through an indirect dependency chain.

**Bad** — mock persists across test files:

```typescript
afterAll(() => {
  mock.restore()
})
```
````

**Good** — mock restored after each test:

```typescript
afterEach(() => {
  mock.restore()
})
afterAll(() => {
  mock.restore() // Final safety net
})
```

````

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add afterEach cleanup guideline for mock pollution"
````

---

## Task 6: Run Full Verification

**Step 1: Run mock pollution check**

Run: `bun run mock-pollution`

Expected: Should now pass or show only legitimate issues

**Step 2: Run all checks**

Run: `bun run check:verbose`

Expected: All checks pass

**Step 3: Final commit**

```bash
git log --oneline -5
```

Should show commits for:

1. Transitive import detection
2. Source file scanner
3. Transitive pollution detection
4. Fixed real pollution issues
5. Updated documentation

---

## Verification Commands

At any point, verify work with:

```bash
# Run just the mock pollution detection
bun run scripts/check-mock-pollution.ts

# Run with strict mode (treat warnings as errors)
bun run scripts/check-mock-pollution.ts --strict

# Run tests for the check-mock-pollution script
bun test tests/scripts/check-mock-pollution/

# Run affected tests
bun test tests/deferred-prompts/

# Run full test suite
bun test
```

---

## Expected Outcome

After this plan is complete:

1. ✅ `scripts/check-mock-pollution.ts` detects transitive mock pollution
2. ✅ The gap is closed - no more silent cross-file mock pollution
3. ✅ Real pollution issues are fixed (background-events, poller tests)
4. ✅ Test suite pass rate improves significantly
5. ✅ Documentation updated with new guidelines
6. ✅ New modules are well-tested and documented

## Files Changed Summary

**Created:**

- `scripts/check-mock-pollution/graph.ts` - Transitive import finder
- `scripts/check-mock-pollution/scanner.ts` - Source file scanner
- `tests/scripts/check-mock-pollution/graph.test.ts` - Tests for graph module
- `tests/scripts/check-mock-pollution/scanner.test.ts` - Tests for scanner module

**Modified:**

- `scripts/check-mock-pollution.ts` - Added Pattern 3: transitive pollution
- `tests/deferred-prompts/background-events.test.ts` - Added afterEach cleanup
- `tests/deferred-prompts/poller.test.ts` - Added afterEach cleanup
- `CLAUDE.md` - Updated testing guidelines
- `tests/scripts/check-mock-pollution.test.ts` - Added transitive tests
