#!/usr/bin/env node
// PreToolUse — snapshot public API surface + coverage before impl file is touched

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
const { tool_name, tool_input, session_id } = input

const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit']
const TEST_PATTERN = /(\.(test|spec)\.(ts|js|tsx|jsx|py)|_test\.go|_test\.rs)$/
const IMPL_PATTERN = /\.(ts|js|tsx|jsx|py|go|rs)$/

if (!WRITE_TOOLS.includes(tool_name)) process.exit(0)

const filePath = tool_input.file_path ?? tool_input.path
if (!filePath || TEST_PATTERN.test(filePath) || !IMPL_PATTERN.test(filePath)) process.exit(0)

const absPath = path.resolve(filePath)
const snapshotKey = absPath.replace(/[/.]/g, '_')
const SNAPSHOT_FILE = `/tmp/tdd-snapshot-${session_id}-${snapshotKey}.json`

function extractSurface(filePath) {
  const src = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''

  const exports = []

  const exportPattern = /^export\s+(async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/gm
  let m
  while ((m = exportPattern.exec(src)) !== null) exports.push(m[2])

  const namedPattern = /^export\s*\{([^}]+)\}/gm
  while ((m = namedPattern.exec(src)) !== null)
    m[1].split(',').forEach((n) =>
      exports.push(
        n
          .trim()
          .split(/\s+as\s+/)
          .pop(),
      ),
    )

  const fnPattern = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/gm
  const signatures = {}
  while ((m = fnPattern.exec(src)) !== null) {
    const paramCount = m[2].trim() === '' ? 0 : m[2].split(',').length
    signatures[m[1]] = paramCount
  }

  return { exports: [...new Set(exports)].sort(), signatures }
}

function findTestFile(implPath) {
  const dir = path.dirname(implPath)
  const ext = path.extname(implPath)
  const base = path.basename(implPath, ext)
  return (
    [
      path.join(dir, `${base}.test${ext}`),
      path.join(dir, `${base}.spec${ext}`),
      path.join(dir, '__tests__', `${base}.test${ext}`),
    ].find(fs.existsSync) ?? null
  )
}

function getCoverage(testFile, implPath) {
  try {
    execSync(`npx vitest run ${testFile} --coverage --coverage.reporter=json --reporter=silent 2>/dev/null`, {
      encoding: 'utf8',
      stdio: 'pipe',
    })
    const coverageJson = JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'))
    const fileCov = coverageJson[path.resolve(implPath)]
    if (!fileCov) return null
    const stmts = Object.values(fileCov.s)
    const covered = stmts.filter((v) => v > 0).length
    return { total: stmts.length, covered, pct: covered / stmts.length }
  } catch {
    return null
  }
}

const testFile = findTestFile(absPath)
const surface = extractSurface(absPath)
const coverage = testFile ? getCoverage(testFile, absPath) : null

fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ surface, coverage, filePath: absPath }))

process.exit(0)
