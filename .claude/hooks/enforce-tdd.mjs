// PreToolUse — enforce TDD: tests must exist before implementation

import fs from 'node:fs'
import path from 'node:path'
import { findTestFile, isTestFile, isGateableImplFile, suggestTestPath } from '../../.hooks/tdd/test-resolver.mjs'
import { FileSessionState } from '../../.hooks/tdd/session-state.mjs'

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
  const { tool_name, tool_input, session_id, cwd } = input

  if (tool_name !== 'Write' && tool_name !== 'Edit') process.exit(0)

  const filePath = tool_input.file_path
  if (!filePath) process.exit(0)
  if (isTestFile(filePath)) process.exit(0)
  if (!isGateableImplFile(filePath, cwd)) process.exit(0)

  const absPath = path.resolve(filePath)

  if (findTestFile(absPath, cwd)) process.exit(0)

  const state = new FileSessionState(session_id)
  const writtenTests = state.getWrittenTests()
  const baseName = path.basename(absPath, path.extname(absPath))
  const alreadyTestedThisSession = writtenTests.some(
    (t) => path.basename(t, path.extname(t)).replace(/\.(test|spec)$/, '') === baseName,
  )
  if (alreadyTestedThisSession) process.exit(0)

  const relPath = path.relative(cwd, filePath)
  const suggestedTest = suggestTestPath(relPath)

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `TDD violation: No test file found for \`${relPath}\`.\n\n` +
          `Write a failing test first:\n` +
          `  → ${suggestedTest}\n\n` +
          `Then re-attempt writing the implementation.`,
      },
    }),
  )
} catch {
  // Fail open — don't block on hook errors
}

process.exit(0)
