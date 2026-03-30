#!/usr/bin/env bun
/**
 * Test Health Analyzer
 *
 * Detects patterns that cause test pollution or flakiness:
 *
 * PATTERN 1 — Barrel mock: mocking a barrel file corrupts sub-module live bindings (HIGH).
 *             Not fixable with afterAll cleanup; must mock at a lower level.
 * PATTERN 2 — Shared module mocked without cleanup: mock persists to other test files (MEDIUM).
 *             Fix: add afterAll(() => { mock.restore() }).
 * PATTERN 3 — Transitive mock pollution: test file B imports src/X which imports the mocked
 *             module, so B is affected even though it doesn't import the mock target directly (HIGH).
 *             Fix: add afterAll(() => { mock.restore() }) to the mocker.
 * PATTERN 4 — Module-level mutable state not reset between tests (MEDIUM).
 *             Detects module-level const/let declarations that persist state between tests.
 *             Fix: export a reset function and call in beforeEach/afterEach.
 *
 * Usage: bun run scripts/check-test-health.ts [--strict]
 */

import { existsSync, readFileSync } from 'fs'
import { dirname, relative, resolve } from 'path'

import ts from 'typescript'

import { findTransitiveImporters } from './check-test-health/graph.js'
import { buildImportGraph } from './check-test-health/scanner.js'

// ─── Configuration ────────────────────────────────────────────────────────────

const rootArgIdx = process.argv.indexOf('--root')
const ROOT =
  rootArgIdx !== -1 && process.argv[rootArgIdx + 1] !== undefined
    ? resolve(process.argv[rootArgIdx + 1]!)
    : resolve(import.meta.dirname, '..')
const STRICT = process.argv.includes('--strict')

// Modules always safe to mock (e.g. intentional mock targets never imported without mocking).
const SAFE_TO_MOCK: readonly string[] = []

// ─── AST helpers ──────────────────────────────────────────────────────────────

function parseSource(filePath: string): ts.SourceFile {
  const source = readFileSync(filePath, 'utf-8')
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
}

function walk(node: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(node)
  ts.forEachChild(node, (child) => {
    walk(child, visitor)
  })
}

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const fromDir = dirname(fromFile)
  const base = resolve(fromDir, specifier)
  for (const candidate of [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}/index.ts`]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Extract all mock.module(specifier, ...) call sites resolved to absolute paths. */
function extractMocks(sf: ts.SourceFile, filePath: string): string[] {
  const results: string[] = []
  walk(sf, (node) => {
    if (!ts.isCallExpression(node)) return
    const { expression: callee, arguments: args } = node
    if (!ts.isPropertyAccessExpression(callee)) return
    if (!ts.isIdentifier(callee.expression) || callee.expression.text !== 'mock') return
    if (!ts.isIdentifier(callee.name) || callee.name.text !== 'module') return
    const firstArg = args[0]
    if (firstArg === undefined || !ts.isStringLiteral(firstArg)) return
    const resolved = resolveSpecifier(filePath, firstArg.text)
    if (resolved !== null) results.push(resolved)
  })
  return results
}

/** Extract value import specifiers (excludes type-only imports). */
function extractImports(sf: ts.SourceFile, filePath: string): string[] {
  const results: string[] = []
  walk(sf, (node) => {
    if (!ts.isImportDeclaration(node)) return
    if (node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword) return
    const { moduleSpecifier } = node
    if (!ts.isStringLiteral(moduleSpecifier)) return
    const resolved = resolveSpecifier(filePath, moduleSpecifier.text)
    if (resolved !== null && !resolved.includes('/tests/')) results.push(resolved)
  })
  return results
}

/** Extract sub-module specifiers re-exported by a barrel file. */
function extractReExports(sf: ts.SourceFile, filePath: string): string[] {
  const results: string[] = []
  walk(sf, (node) => {
    if (!ts.isExportDeclaration(node)) return
    if (node.isTypeOnly) return
    const { moduleSpecifier } = node
    if (moduleSpecifier === undefined || !ts.isStringLiteral(moduleSpecifier)) return
    const resolved = resolveSpecifier(filePath, moduleSpecifier.text)
    if (resolved !== null) results.push(resolved)
  })
  return results
}

/** Returns true if the file has afterAll(() => { mock.restore() }) cleanup. */
function hasRestoreCleanup(sf: ts.SourceFile): boolean {
  let found = false
  walk(sf, (node) => {
    if (found) return
    if (!ts.isCallExpression(node)) return
    if (!ts.isIdentifier(node.expression) || node.expression.text !== 'afterAll') return
    walk(node, (inner) => {
      if (found) return
      if (!ts.isCallExpression(inner)) return
      const callee = inner.expression
      if (!ts.isPropertyAccessExpression(callee)) return
      if (!ts.isIdentifier(callee.expression) || callee.expression.text !== 'mock') return
      if (!ts.isIdentifier(callee.name) || callee.name.text !== 'restore') return
      found = true
    })
  })
  return found
}

function rel(p: string): string {
  return relative(ROOT, p)
}

// ─── Pattern 4: Module-level state detection helpers ────────────────────────────

/** Extract module-level const/let declarations with mutable initializers */
function extractModuleLevelState(sf: ts.SourceFile): Array<{ name: string; line: number; type: string }> {
  const results: Array<{ name: string; line: number; type: string }> = []

  function walkNode(node: ts.Node): void {
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

        const initText = decl.initializer.getText(sf)
        let type = 'unknown'

        if (initText.includes('new Set')) type = 'Set'
        else if (initText.includes('new Map')) type = 'Map'
        else if (initText.includes('new WeakMap')) type = 'WeakMap'
        else if (initText.includes('new WeakSet')) type = 'WeakSet'
        else if (initText.startsWith('[')) type = 'Array'
        else if (initText.startsWith('{') && initText.includes(':')) type = 'Object'
        else if (initText.includes('Date.now')) type = 'Timestamp'

        if (type !== 'unknown') {
          results.push({ name, line, type })
        }
      }
    }
    ts.forEachChild(node, walkNode)
  }

  walkNode(sf)
  return results
}

/** Check if source file exports a reset/clear function for given state variable */
function hasResetFunction(sf: ts.SourceFile, stateVarName: string): boolean {
  let found = false

  function walkNode(node: ts.Node): void {
    if (found) return

    // Check exported function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      if (isExported && /reset|clear/i.test(node.name.text)) {
        const bodyText = node.getText(sf)
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
            const initText = decl.initializer?.getText(sf) ?? ''
            if (initText.includes(stateVarName)) {
              found = true
              return
            }
          }
        }
      }
    }

    ts.forEachChild(node, walkNode)
  }

  walkNode(sf)
  return found
}

/** Check if test file has beforeEach/afterEach cleanup */
function hasTestCleanup(sf: ts.SourceFile): boolean {
  let found = false

  function walkNode(node: ts.Node): void {
    if (found) return

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fnName = node.expression.text
      if (fnName === 'beforeEach' || fnName === 'afterEach') {
        // Check if callback contains reset-like calls
        if (node.arguments.length > 0) {
          const callback = node.arguments[0]
          if (callback) {
            const callbackText = callback.getText(sf)
            if (/reset|clear|mock\.restore/i.test(callbackText)) {
              found = true
              return
            }
          }
        }
      }
    }

    ts.forEachChild(node, walkNode)
  }

  walkNode(sf)
  return found
}

/** Check if a specific state variable is referenced in cleanup */
function stateHasCleanup(sf: ts.SourceFile, stateVarName: string): boolean {
  let found = false

  function walkNode(node: ts.Node): void {
    if (found) return

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fnName = node.expression.text
      if (fnName === 'beforeEach' || fnName === 'afterEach') {
        const callback = node.arguments[0]
        if (callback) {
          const callbackText = callback.getText(sf)
          if (callbackText.includes(stateVarName)) {
            found = true
            return
          }
        }
      }
    }

    ts.forEachChild(node, walkNode)
  }

  walkNode(sf)
  return found
}

// ─── Scan files ───────────────────────────────────────────────────────────────

const testGlob = new Bun.Glob('tests/**/*.test.ts')
const testFiles = (await Array.fromAsync(testGlob.scan({ cwd: ROOT }))).map((f) => resolve(ROOT, f))
const unitTests = testFiles.filter((f) => !f.includes('/e2e/'))

type FileInfo = { path: string; mocks: string[]; imports: string[]; hasCleanup: boolean }

// Scan test files AND source files to build the complete import graph.
const allFiles: string[] = [
  ...unitTests,
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

const importGraph = buildImportGraph(files.map((f) => ({ path: f.path, imports: f.imports })))

const mockedBy = new Map<string, string[]>()
const importedBy = new Map<string, string[]>()
const mockerHasCleanup = new Map<string, boolean>()

for (const file of files) {
  for (const mod of file.mocks) {
    if (!mockedBy.has(mod)) mockedBy.set(mod, [])
    mockedBy.get(mod)!.push(file.path)
    mockerHasCleanup.set(file.path, file.hasCleanup)
  }
  for (const mod of file.imports) {
    if (!importedBy.has(mod)) importedBy.set(mod, [])
    importedBy.get(mod)!.push(file.path)
  }
}

// ─── Pattern detection ────────────────────────────────────────────────────────

type Issue = { severity: 'HIGH' | 'MEDIUM'; lines: string[] }
const issues: Issue[] = []

// Pattern 1: Barrel mock
for (const [mockedModule, mockers] of mockedBy) {
  if (!existsSync(mockedModule)) continue
  const sf = parseSource(mockedModule)
  const reExports = extractReExports(sf, mockedModule)
  if (reExports.length === 0) continue
  for (const subModule of reExports) {
    // Only test files matter here; source file victims are handled by Pattern 3.
    const directImporters = (importedBy.get(subModule) ?? []).filter(
      (f) => f.endsWith('.test.ts') && !mockers.includes(f),
    )
    if (directImporters.length === 0) continue
    for (const mocker of mockers) {
      issues.push({
        severity: 'HIGH',
        lines: [
          `  [HIGH] Barrel mock corrupts sub-module bindings (Bun live-binding issue)`,
          `  Mocker : ${rel(mocker)}`,
          `  Barrel : ${rel(mockedModule)}`,
          `  Sub-mod: ${rel(subModule)}`,
          `  Victims: ${directImporters.map(rel).join(', ')}`,
          `  Fix    : remove the barrel mock; mock at a lower level instead`,
        ],
      })
    }
  }
}

// Pattern 2: Shared module mocked without cleanup
// Note: Bun runs each test file in its own isolated worker, so mock.module calls
// in one file do NOT bleed into another file's process. This pattern only matters
// within a single file's execution context. Files with afterAll(() => { mock.restore() })
// are considered safe; only flag files that mock shared modules with NO cleanup at all.
for (const [mockedModule, mockers] of mockedBy) {
  if (SAFE_TO_MOCK.some((s) => mockedModule.endsWith(s))) continue
  const directImporters = (importedBy.get(mockedModule) ?? []).filter((f) => !mockers.includes(f))
  if (directImporters.length === 0) continue
  for (const mocker of mockers) {
    if (mockerHasCleanup.get(mocker) === true) continue
    issues.push({
      severity: 'MEDIUM',
      lines: [
        `  [MEDIUM] Shared module mocked without cleanup`,
        `  Mocker : ${rel(mocker)}`,
        `  Module : ${rel(mockedModule)}`,
        `  Victims: ${directImporters.map(rel).join(', ')}`,
        `  Fix    : add afterAll(() => { mock.restore() }), or narrow the mock target`,
      ],
    })
  }
}

// Pattern 3: Transitive mock pollution
for (const [mockedModule, mockers] of mockedBy) {
  if (SAFE_TO_MOCK.some((s) => mockedModule.endsWith(s))) continue
  const transitiveImporters = findTransitiveImporters(mockedModule, importGraph)
  const directTestImporters = new Set(importedBy.get(mockedModule) ?? [])
  const affectedTestFiles = transitiveImporters.filter((f) => {
    return f.endsWith('.test.ts') && !mockers.includes(f) && !directTestImporters.has(f)
  })
  if (affectedTestFiles.length === 0) continue
  for (const mocker of mockers) {
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

// ─── Report ───────────────────────────────────────────────────────────────────

const errors = issues.filter((i) => i.severity === 'HIGH' || STRICT)
const warnings = issues.filter((i) => i.severity === 'MEDIUM' && !STRICT)

if (issues.length === 0) {
  console.log('✓ No mock pollution issues detected.')
  process.exit(0)
}

if (errors.length > 0) {
  console.log(`\n✗ ${errors.length} mock pollution error(s) found:\n`)
  for (const issue of errors) {
    for (const line of issue.lines) console.log(line)
    console.log()
  }
}

if (warnings.length > 0) {
  console.log(`⚠  ${warnings.length} mock pollution warning(s) (run with --strict to fail on these):\n`)
  for (const issue of warnings) {
    for (const line of issue.lines) console.log(line)
    console.log()
  }
}

if (errors.length > 0) process.exit(1)
