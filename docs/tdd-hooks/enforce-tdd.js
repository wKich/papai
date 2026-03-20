#!/usr/bin/env node
// PreToolUse — enforce TDD: tests must exist before implementation

import fs from 'fs'
import path from 'path'

const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
const { tool_name, tool_input, session_id } = input

const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit']
if (!WRITE_TOOLS.includes(tool_name)) process.exit(0)

const filePath = tool_input.file_path ?? tool_input.path ?? tool_input.target_file
if (!filePath) process.exit(0)

const IMPL_PATTERN = /\.(ts|js|tsx|jsx|py|go|rs)$/
const TEST_PATTERN = /(\.(test|spec)\.(ts|js|tsx|jsx|py)|_test\.go|_test\.rs)$/
const TEST_SUFFIXES = ['.test', '.spec']

if (TEST_PATTERN.test(filePath)) process.exit(0)
if (!IMPL_PATTERN.test(filePath)) process.exit(0)

function findTestFile(implPath) {
  const dir = path.dirname(implPath)
  const ext = path.extname(implPath)
  const base = path.basename(implPath, ext)

  for (const suffix of TEST_SUFFIXES) {
    const candidate = path.join(dir, `${base}${suffix}${ext}`)
    if (fs.existsSync(candidate)) return candidate
  }

  for (const suffix of TEST_SUFFIXES) {
    const candidate = path.join(dir, '__tests__', `${base}${suffix}${ext}`)
    if (fs.existsSync(candidate)) return candidate
  }

  return null
}

const STATE_FILE = `/tmp/tdd-session-${session_id}.json`

function loadSessionState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return { writtenTests: [] }
  }
}

const state = loadSessionState()
const absPath = path.resolve(filePath)
const alreadyTestedThisSession = state.writtenTests.some((t) =>
  absPath.includes(path.basename(t, path.extname(t)).replace(/\.(test|spec)$/, '')),
)

const testOnDisk = findTestFile(absPath)

if (testOnDisk || alreadyTestedThisSession) process.exit(0)

console.log(
  JSON.stringify({
    decision: 'block',
    reason:
      `TDD violation: No test file found for \`${filePath}\`.\n\n` +
      `Write a failing test first:\n` +
      `  → ${path.join(
        path.dirname(filePath),
        path.basename(filePath, path.extname(filePath)) + '.test' + path.extname(filePath),
      )}\n\n` +
      `Then re-attempt writing the implementation.`,
  }),
)

process.exit(0)
