#!/usr/bin/env bun
/**
 * Static analyzer for Bun test mock pollution.
 *
 * Uses the TypeScript compiler API for precise AST-based analysis instead of
 * regex/string heuristics, so it correctly handles all edge cases: nested
 * expressions, aliased identifiers that happen to contain keywords, comments
 * inside mock calls, template literals, etc.
 *
 * Detects two patterns that cause cross-file test failures in Bun's shared
 * module registry (all test files run in one process):
 *
 * PATTERN 1 — Barrel mock (HIGH RISK)
 *   A test mocks a barrel module (e.g. commands/index.ts) that re-exports from
 *   sub-modules (e.g. commands/admin.ts). When Bun resolves the barrel's imports
 *   it can corrupt the sub-module's live bindings — so any other test that imports
 *   the sub-module directly receives the mock's value instead of the real one.
 *   This is NOT fixable with afterAll(() => mock.restore()).
 *   Fix: remove the barrel mock; mock at a lower level or skip entirely.
 *
 * PATTERN 2 — Shared module mocked without cleanup (MEDIUM RISK)
 *   A test mocks a module that other test files import directly without mocking.
 *   The mock persists across test files since Bun shares the module registry.
 *   Files that call mock.restore() inside afterAll() are considered mitigated and
 *   are not flagged.
 *   Fix: add afterAll(() => { mock.restore() }), remove the mock, or narrow target.
 *
 * Usage:
 *   bun run scripts/check-mock-pollution.ts
 *   bun run scripts/check-mock-pollution.ts --strict   # treat MEDIUM as error too
 */

import { existsSync, readFileSync } from 'fs'
import { dirname, relative, resolve } from 'path'

import ts from 'typescript'

// ─── Configuration ────────────────────────────────────────────────────────────

const rootArgIdx = process.argv.indexOf('--root')
const ROOT =
  rootArgIdx !== -1 && process.argv[rootArgIdx + 1] !== undefined
    ? resolve(process.argv[rootArgIdx + 1]!)
    : resolve(import.meta.dirname, '..')
const STRICT = process.argv.includes('--strict')

// Modules that are always safe to mock: they are the intentional mock targets
// (e.g. external packages, db layer). Only list modules where the mock is
// architecturally correct and will never be imported without mocking.
const SAFE_TO_MOCK: readonly string[] = [
  // External packages are fine — Bun doesn't share them across files in the
  // same way as project-local modules.
]

// ─── AST helpers ──────────────────────────────────────────────────────────────

/** Parse a source file into a TypeScript AST (no type-checking, parse only). */
function parseSource(filePath: string): ts.SourceFile {
  const source = readFileSync(filePath, 'utf-8')
  // setParentNodes=true is required for ts.forEachChild to traverse correctly
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
}

/** Visit every node in the subtree rooted at `node`. */
function walk(node: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(node)
  ts.forEachChild(node, (child) => {
    walk(child, visitor)
  })
}

/** Resolve a relative import specifier from a source file to an absolute path. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  // external package — skip
  if (!specifier.startsWith('.')) return null
  const fromDir = dirname(fromFile)
  const base = resolve(fromDir, specifier)
  // Bun imports use .js extensions that map to .ts source files
  for (const candidate of [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}/index.ts`]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Extract all mock.module(specifier, ...) call sites from the AST.
 * Matches the pattern: mock.module('<literal>', factory)
 * Correctly handles `void mock.module(...)` wrappers via full tree walk.
 */
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

/**
 * Extract all static value import specifiers that resolve to src/ modules.
 * Excludes type-only imports (`import type { X }`) — they are erased at
 * runtime and never trigger module registry entries.
 */
function extractImports(sf: ts.SourceFile, filePath: string): string[] {
  const results: string[] = []
  walk(sf, (node) => {
    if (!ts.isImportDeclaration(node)) return
    // Skip type-only imports (`import type { X }`): phaseModifier === TypeKeyword
    if (node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword) return
    const { moduleSpecifier } = node
    if (!ts.isStringLiteral(moduleSpecifier)) return
    const resolved = resolveSpecifier(filePath, moduleSpecifier.text)
    if (resolved !== null && !resolved.includes('/tests/')) results.push(resolved)
  })
  return results
}

/**
 * Extract sub-module specifiers that a barrel file re-exports.
 * Matches: export { X } from './Y'  and  export * from './Y'
 * Excludes type-only re-exports (`export type { X } from './Y'`).
 */
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

/**
 * Returns true if the file registers an afterAll cleanup via mock.restore().
 * Looks for a CallExpression `afterAll(...)` that contains a descendant
 * CallExpression `mock.restore()` anywhere in its argument subtree.
 * Such files are exempt from Pattern 2: the risk is mitigated by cleanup.
 */
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

// ─── Scan test files ──────────────────────────────────────────────────────────

const testGlob = new Bun.Glob('tests/**/*.test.ts')
const testFiles = (await Array.fromAsync(testGlob.scan({ cwd: ROOT }))).map((f) => resolve(ROOT, f))
// Exclude E2E tests — they run in isolation with Docker
const unitTests = testFiles.filter((f) => !f.includes('/e2e/'))

type FileInfo = {
  path: string
  mocks: string[]
  imports: string[]
  hasCleanup: boolean
}

const files: FileInfo[] = unitTests.map((filePath) => {
  const sf = parseSource(filePath)
  return {
    path: filePath,
    mocks: extractMocks(sf, filePath),
    imports: extractImports(sf, filePath),
    hasCleanup: hasRestoreCleanup(sf),
  }
})

// Build indexes: module → files that mock/import it
const mockedBy = new Map<string, string[]>()
const importedBy = new Map<string, string[]>()
// Track which mocker files have afterAll cleanup
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

// ─── Pattern 1: Barrel mock ───────────────────────────────────────────────────

type Issue = { severity: 'HIGH' | 'MEDIUM'; lines: string[] }
const issues: Issue[] = []

for (const [mockedModule, mockers] of mockedBy) {
  if (!existsSync(mockedModule)) continue
  const sf = parseSource(mockedModule)
  const reExports = extractReExports(sf, mockedModule)
  if (reExports.length === 0) continue

  for (const subModule of reExports) {
    const directImporters = (importedBy.get(subModule) ?? []).filter(
      // Only flag files that import sub-module directly AND are NOT the mocker itself
      (f) => !mockers.includes(f),
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

// ─── Pattern 2: Shared module mocked without cleanup ─────────────────────────

for (const [mockedModule, mockers] of mockedBy) {
  if (SAFE_TO_MOCK.some((s) => mockedModule.endsWith(s))) continue

  const directImporters = (importedBy.get(mockedModule) ?? []).filter((f) => !mockers.includes(f))
  if (directImporters.length === 0) continue

  for (const mocker of mockers) {
    // Files with afterAll(() => mock.restore()) cleanup are considered mitigated.
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
