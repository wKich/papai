// .opencode/plugins/tdd-enforcement.ts
// OpenCode plugin — TDD enforcement: gate + tracker + test runner with deferred blocking

import path from 'node:path'

import type { Plugin } from '@opencode-ai/plugin'

import { MemorySessionState } from '../../.hooks/tdd/session-state.mjs'
import { findTestFile, isTestFile, isGateableImplFile, suggestTestPath } from '../../.hooks/tdd/test-resolver.mjs'
import { runTest } from '../../.hooks/tdd/test-runner.mjs'

// OpenCode edit tools that use filePath (excludes patch — uses patchText)
const EDIT_TOOLS = new Set(['write', 'edit', 'multiedit'])

export const TddEnforcement: Plugin = async ({ directory }) => {
  return {
    // ─── enforce-tdd + deferred test-failure blocking ───
    'tool.execute.before': async (input, output) => {
      const state = new MemorySessionState(input.sessionID)

      // DEFERRED BLOCKING: If previous edit broke tests, block ALL tools until fixed
      const pending = state.getPendingFailure()
      if (pending) {
        throw new Error(
          `Tests are RED after your edit of \`${pending.file}\`.\n\n` +
            `You must fix the failing tests before proceeding.\n\n` +
            `── Test output ──────────────────────────────\n` +
            `${pending.output}\n` +
            `─────────────────────────────────────────────\n\n` +
            `Fix the regression, then re-attempt.`,
        )
      }

      // TDD GATE: Block impl writes without test
      if (!EDIT_TOOLS.has(input.tool)) return

      const filePath = output.args.filePath as string
      if (!filePath) return
      if (isTestFile(filePath)) return
      if (!isGateableImplFile(filePath, directory)) return

      const absPath = path.resolve(directory, filePath)
      if (findTestFile(absPath, directory)) return

      const writtenTests = state.getWrittenTests()
      const baseName = path.basename(absPath, path.extname(absPath))
      const alreadyTestedThisSession = writtenTests.some(
        (t: string) => path.basename(t, path.extname(t)).replace(/\.(test|spec)$/, '') === baseName,
      )
      if (alreadyTestedThisSession) return

      const relPath = path.relative(directory, filePath)
      const suggestedTest = suggestTestPath(relPath)

      throw new Error(
        `TDD violation: No test file found for \`${relPath}\`.\n\n` +
          `Write a failing test first:\n  → ${suggestedTest}\n\n` +
          `Then re-attempt writing the implementation.`,
      )
    },

    // ─── enforce-tdd-tracker + verify-tests-pass (deferred) ───
    'tool.execute.after': async (input) => {
      if (!EDIT_TOOLS.has(input.tool)) return

      const filePath = input.args.filePath as string
      if (!filePath) return

      const state = new MemorySessionState(input.sessionID)

      // Track test file writes
      if (isTestFile(filePath)) {
        state.addWrittenTest(path.resolve(directory, filePath))
      }

      // Run tests after impl/test edits
      const absPath = path.resolve(directory, filePath)
      const testFile = isTestFile(filePath) ? absPath : findTestFile(absPath, directory)

      if (!testFile) return

      const result = await runTest(testFile, directory)

      if (!result.passed) {
        // Store failure — will block next tool.execute.before
        const relPath = path.relative(directory, filePath)
        state.setPendingFailure(relPath, result.output)
      } else {
        // Tests pass — clear any pending failure
        state.clearPendingFailure()
      }
    },
  }
}
