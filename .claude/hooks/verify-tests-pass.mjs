// PostToolUse — after every file write, run related tests.
// If tests fail, block the agent so it must fix before proceeding.

import fs from 'node:fs'
import path from 'node:path'

import { findTestFile, isTestFile } from '../../.hooks/tdd/test-resolver.mjs'
import { runTest } from '../../.hooks/tdd/test-runner.mjs'

const IMPL_PATTERN = /\.(?:ts|js|tsx|jsx)$/

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
  const { tool_name, tool_input, cwd } = input

  if (tool_name !== 'Write' && tool_name !== 'Edit') process.exit(0)

  const filePath = tool_input.file_path
  if (!filePath) process.exit(0)
  if (!IMPL_PATTERN.test(filePath)) process.exit(0)

  const absPath = path.resolve(filePath)
  const testFile = isTestFile(filePath) ? absPath : findTestFile(absPath, cwd)
  if (!testFile) process.exit(0)

  const result = await runTest(testFile, cwd)

  if (!result.passed) {
    const relFile = path.relative(cwd, filePath)
    console.log(
      JSON.stringify({
        decision: 'block',
        reason:
          `Tests are RED after your edit of \`${relFile}\`.\n\n` +
          `You must fix the failing tests before proceeding.\n\n` +
          `── Test output ──────────────────────────────\n` +
          `${result.output}\n` +
          `─────────────────────────────────────────────\n\n` +
          `Fix the regression, then re-attempt.`,
      }),
    )
  }
} catch {
  // Fail open — don't block on hook errors
}

process.exit(0)
