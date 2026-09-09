// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Boundary guard of the afk-runner extraction: nothing under the runner's own
 * trees may import outside them. The guard is deliberately self-contained — no
 * papai module, no AST tooling, and no allowlist, ever: every violation fails
 * by file and specifier, and the only remedy is fixing the import. Leg 1
 * fences relative imports to the union of the runner package and its test
 * tree; leg 2 requires every bare package import under the runner sources to
 * be declared in the runner manifest.
 */

const TESTS_ROOT = import.meta.dir
const REPO_ROOT = path.resolve(TESTS_ROOT, '..', '..')
const RUNNER_ROOT = path.join(REPO_ROOT, 'afk-runner')
const RUNNER_SRC_ROOT = path.join(RUNNER_ROOT, 'src')

const SCANNED_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx', '.tsx'])

/**
 * Statement-level specifier extraction over every import form the runtime can
 * load: named/default/type clauses re-exported or not, bare side-effect
 * imports, dynamic imports, and CommonJS requires. The clause body between the
 * statement keyword and its resolution clause may span the newlines a
 * formatter puts inside wrapped statements, and excludes quotes and
 * semicolons so a match cannot leap across a quoted specifier or a statement
 * boundary onto unrelated text.
 */
const SPECIFIER_PATTERNS: readonly RegExp[] = [
  /\bimport\s[^;'"]*?\bfrom\s*(['"])([^'"]+)\1/gu,
  /\bexport\s[^;'"]*?\bfrom\s*(['"])([^'"]+)\1/gu,
  /\bimport\s*(['"])([^'"]+)\1/gu,
  /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/gu,
  /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/gu,
]

function walkSources(dir: string): string[] {
  const found: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...walkSources(full))
    } else if (entry.isFile() && SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
      found.push(full)
    }
  }
  return found
}

function extractSpecifiers(text: string): string[] {
  const specs = new Set<string>()
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const spec = match[2]
      if (spec !== undefined) specs.add(spec)
    }
  }
  return [...specs]
}

function isRelative(spec: string): boolean {
  return spec.startsWith('./') || spec.startsWith('../')
}

function isBuiltin(spec: string): boolean {
  return spec.startsWith('node:') || spec.startsWith('bun:')
}

function packageNameOf(spec: string): string {
  if (spec.startsWith('@')) {
    const segments = spec.split('/')
    return `${segments[0] ?? ''}/${segments[1] ?? ''}`
  }
  return spec.split('/')[0] ?? ''
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`))
}

function displayPath(file: string): string {
  return path.relative(REPO_ROOT, file)
}

function fenceOffenders(): string[] {
  const offenders: string[] = []
  for (const file of [...walkSources(RUNNER_SRC_ROOT), ...walkSources(TESTS_ROOT)]) {
    const text = fs.readFileSync(file, 'utf8')
    for (const spec of extractSpecifiers(text)) {
      if (!isRelative(spec)) continue
      const resolved = path.resolve(path.dirname(file), spec)
      if (isInsideRoot(RUNNER_ROOT, resolved) || isInsideRoot(TESTS_ROOT, resolved)) continue
      offenders.push(`${displayPath(file)} -> ${spec} (resolves to ${displayPath(resolved)})`)
    }
  }
  return offenders.sort()
}

/** Names listed under the runner manifest dependencies; a manifest without a
 * dependency map declares nothing, so every bare import would offend. */
function declaredDependencies(parsed: unknown): readonly string[] {
  if (typeof parsed !== 'object' || parsed === null || !('dependencies' in parsed)) return []
  const deps: unknown = parsed.dependencies
  if (typeof deps !== 'object' || deps === null) return []
  return Object.keys(deps)
}

function manifestOffenders(): string[] {
  const manifestPath = path.join(RUNNER_ROOT, 'package.json')
  const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const declared = new Set(declaredDependencies(parsed))
  const offenders: string[] = []
  for (const file of walkSources(RUNNER_SRC_ROOT)) {
    const text = fs.readFileSync(file, 'utf8')
    for (const spec of extractSpecifiers(text)) {
      if (isRelative(spec) || isBuiltin(spec)) continue
      const name = packageNameOf(spec)
      if (!declared.has(name)) {
        offenders.push(
          `${displayPath(file)} -> ${spec} (package ${name} is not in afk-runner/package.json dependencies)`,
        )
      }
    }
  }
  return offenders.sort()
}

describe('afk-runner boundary guard', () => {
  test('fence: no scanned file under the runner trees imports outside them', () => {
    const offenders = fenceOffenders()
    expect(offenders, 'upward imports escaping the afk-runner fence').toEqual([])
  })

  test('manifest: every bare package import under the runner sources is declared', () => {
    const offenders = manifestOffenders()
    expect(offenders, 'undeclared package imports under afk-runner/src').toEqual([])
  })
})
