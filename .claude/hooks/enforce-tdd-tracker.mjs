// PostToolUse — record when a test file is written this session

import fs from 'node:fs'
import path from 'node:path'

import { FileSessionState } from '../../.hooks/tdd/session-state.mjs'
import { isTestFile } from '../../.hooks/tdd/test-resolver.mjs'

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
  const { tool_name, tool_input, session_id } = input

  if (tool_name !== 'Write' && tool_name !== 'Edit') process.exit(0)

  const filePath = tool_input.file_path
  if (!filePath || !isTestFile(filePath)) process.exit(0)

  const state = new FileSessionState(session_id)
  state.addWrittenTest(path.resolve(filePath))
} catch {
  // Fail open — don't block on hook errors
}

process.exit(0)
