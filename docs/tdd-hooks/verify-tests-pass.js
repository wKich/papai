#!/usr/bin/env node
// PostToolUse — after every impl file write, run related tests.
// If tests fail, block the agent so it must fix before proceeding.

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
const { tool_name, tool_input } = input

const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit']
const TEST_PATTERN = /(\.(test|spec)\.(ts|js|tsx|jsx|py)|_test\.go|_test\.rs)$/
const IMPL_PATTERN = /\.(ts|js|tsx|jsx|py|go|rs)$/

if (!WRITE_TOOLS.includes(tool_name)) process.exit(0)

const filePath = tool_input.file_path ?? tool_input.path ?? tool_input.target_file
if (!filePath) process.exit(0)

if (TEST_PATTERN.test(filePath)) process.exit(0)
if (!IMPL_PATTERN.test(filePath)) process.exit(0)

function findTestFile(implPath) {
  const dir = path.dirname(implPath)
  const ext = path.extname(implPath)
  const base = path.basename(implPath, ext)
  return (
    [
      path.join(dir, `${base}.test${ext}`),
      path.join(dir, `${base}.spec${ext}`),
      path.join(dir, '__tests__', `${base}.test${ext}`),
      path.join(dir, '__tests__', `${base}.spec${ext}`),
    ].find(fs.existsSync) ?? null
  )
}

function detectRunner(testFile) {
  if (fs.existsSync('vitest.config.ts') || fs.existsSync('vitest.config.js'))
    return `npx vitest run ${testFile} --reporter=verbose`

  if (fs.existsSync('jest.config.ts') || fs.existsSync('jest.config.js')) return `npx jest ${testFile} --no-coverage`

  if (fs.existsSync('package.json')) {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    if (pkg.scripts?.test?.includes('vitest')) return `npx vitest run ${testFile}`
    if (pkg.scripts?.test?.includes('jest')) return `npx jest ${testFile}`
  }

  return null
}

const testFile = findTestFile(path.resolve(filePath))
if (!testFile) process.exit(0)

const runner = detectRunner(testFile)
if (!runner) process.exit(0)

let output = ''
let passed = true

try {
  output = execSync(runner, { encoding: 'utf8', stdio: 'pipe' })
} catch (err) {
  passed = false
  output = (err.stdout ?? '') + '\n' + (err.stderr ?? '')
}

if (!passed) {
  console.log(
    JSON.stringify({
      decision: 'block',
      reason:
        `Tests are RED after your edit of \`${filePath}\`.\n\n` +
        `You must restore green before proceeding.\n\n` +
        `── Test output ──────────────────────────────\n` +
        `${output.slice(0, 3000)}\n` +
        `─────────────────────────────────────────────\n\n` +
        `Fix the regression, then re-attempt.`,
    }),
  )
}

process.exit(0)
