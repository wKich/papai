#!/usr/bin/env bun
/**
 * Static analyzer for Bun test mock pollution.
 * Uses TypeScript compiler API for precise AST-based analysis.
 *
 * Detects 3 patterns (in a Bun process where all test files share one module registry):
 *   PATTERN 1 — Barrel mock: mocking a barrel file corrupts sub-module live bindings (HIGH).
 *               Not fixable with afterAll cleanup; must mock at a lower level.
 *   PATTERN 2 — Shared module mocked without cleanup: mock persists to other test files (MEDIUM).
 *               Fix: add afterAll(() => { mock.restore() }).
 *   PATTERN 3 — Transitive mock pollution: test file B imports src/X which imports the mocked
 *               module, so B is affected even though it doesn't import the mock target directly (HIGH).
 *               Fix: add afterAll(() => { mock.restore() }) to the mocker.
 *
 * Usage: bun run scripts/check-mock-pollution.ts [--strict]
 */

import { existsSync, readFileSync } from 'fs'
import { dirname, relative, resolve } from 'path'

import ts from 'typescript'

import { findTransitiveImporters } from './check-mock-pollution/graph.js'
import { buildImportGraph } from './check-mock-pollution/scanner.js'

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
