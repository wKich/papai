// Block impl writes if no test file exists (Red phase gate)

import path from 'node:path'

import { getSessionsDir } from '../paths.mjs'
import { FileSessionState } from '../session-state.mjs'
import { findTestFile, isTestFile, isGateableImplFile, suggestTestPath } from '../test-resolver.mjs'

/**
 * @param {{ tool_input: { file_path: string }, session_id: string, cwd: string }} ctx
 * @returns {{ decision: 'block', reason: string } | null}
 */
export function enforceTdd(ctx) {
  try {
    const { tool_input, session_id, cwd } = ctx
    const filePath = tool_input.file_path
    if (!filePath) return null
    if (isTestFile(filePath)) return null
    if (!isGateableImplFile(filePath, cwd)) return null

    const absPath = path.resolve(filePath)

    if (findTestFile(absPath, cwd)) return null

    const state = new FileSessionState(session_id, getSessionsDir(cwd))
    const writtenTests = state.getWrittenTests()
    const alreadyTestedThisSession = writtenTests.some((testAbsPath) => {
      const testRel = path.relative(cwd, testAbsPath)
      if (testRel.startsWith('tests/') || testRel.startsWith('tests\\')) {
        const withoutTests = testRel.replace(/^tests[/\\]/, '')
        const ext = path.extname(withoutTests)
        const base = withoutTests.slice(0, -ext.length).replace(/\.(test|spec)$/, '')
        if (path.join(cwd, 'src', `${base}${ext}`) === absPath) return true
      }
      return false
    })
    if (alreadyTestedThisSession) return null

    const relPath = path.relative(cwd, filePath)
    const suggestedTest = suggestTestPath(relPath)

    return {
      decision: 'block',
      reason:
        `Cannot write \`${relPath}\` because no test file exists.\n\n` +
        `Step 1: Write a failing test:\n` +
        `  → ${suggestedTest}\n\n` +
        `Step 2: Write the implementation to make the test pass.`,
    }
  } catch {
    return null
  }
}
