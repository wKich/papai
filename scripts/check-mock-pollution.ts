#!/usr/bin/env bun
/**
 * Static analyzer for Bun test mock pollution.
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

// ─── Configuration ────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, '..')
const STRICT = process.argv.includes('--strict')

// Modules that are always safe to mock: they are the intentional mock targets
// (e.g. external packages, db layer). Only list modules where the mock is
// architecturally correct and will never be imported without mocking.
const SAFE_TO_MOCK: readonly string[] = [
  // External packages are fine — Bun doesn't share them across files in the
  // same way as project-local modules.
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/** Extract all mock.module() specifiers from a test file's source. */
function extractMocks(source: string, filePath: string): string[] {
  const results: string[] = []
  const re = /mock\.module\(\s*['"`]([^'"`]+)['"`]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const resolved = resolveSpecifier(filePath, m[1]!)
    if (resolved !== null) results.push(resolved)
  }
  return results
}

/** Extract all static import specifiers that resolve to src/ modules. */
function extractImports(source: string, filePath: string): string[] {
  const results: string[] = []
  // Matches: import ... from '...'  (static imports only, not dynamic)
  const re =
    /^\s*import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+(?:\s*,\s*\{[^}]*\})?)\s+from\s+['"`]([^'"`]+)['"`]/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const resolved = resolveSpecifier(filePath, m[1]!)
    if (resolved !== null && !resolved.includes('/tests/')) results.push(resolved)
  }
  return results
}

/**
 * Returns true if the file registers an afterAll cleanup via mock.restore().
 * Such files are exempt from Pattern 2: the risk is mitigated even if timing
 * is not guaranteed to be perfect in all Bun versions.
 */
function hasRestoreCleanup(source: string): boolean {
  return source.includes('afterAll') && source.includes('mock.restore()')
}

/** Extract sub-modules that a barrel file re-exports. */
function extractReExports(source: string, filePath: string): string[] {
  const results: string[] = []
  // export { X } from './Y'  or  export * from './Y'
  const re = /^\s*export\s+(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s+from\s+['"`]([^'"`]+)['"`]/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const resolved = resolveSpecifier(filePath, m[1]!)
    if (resolved !== null) results.push(resolved)
  }
  return results
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
  // absolute paths of mocked modules
  mocks: string[]
  // absolute paths of directly imported src modules
  imports: string[]
  // true when the file has afterAll(() => mock.restore()) cleanup
  hasCleanup: boolean
}

const files: FileInfo[] = unitTests.map((filePath) => {
  const source = readFileSync(filePath, 'utf-8')
  return {
    path: filePath,
    mocks: extractMocks(source, filePath),
    imports: extractImports(source, filePath),
    hasCleanup: hasRestoreCleanup(source),
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
  const source = readFileSync(mockedModule, 'utf-8')
  const reExports = extractReExports(source, mockedModule)
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

// ─── Pattern 2: Shared module mocked without isolation ───────────────────────

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

if (errors.length > 0) {
  process.exit(1)
}
