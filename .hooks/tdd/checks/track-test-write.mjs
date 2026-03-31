// Record test files written this session (side-effect only)

import path from 'node:path'

import { getSessionsDir } from '../paths.mjs'
import { FileSessionState } from '../session-state.mjs'
import { isTestFile } from '../test-resolver.mjs'

/**
 * @param {{ tool_input: { file_path: string }, session_id: string, cwd: string }} ctx
 * @returns {null}
 */
export function trackTestWrite(ctx) {
  try {
    const { tool_input, session_id, cwd } = ctx
    const filePath = tool_input.file_path
    if (!filePath || !isTestFile(filePath)) return null

    const state = new FileSessionState(session_id, getSessionsDir(cwd))
    state.addWrittenTest(path.resolve(filePath))
  } catch {
    // Fail open
  }
  return null
}
