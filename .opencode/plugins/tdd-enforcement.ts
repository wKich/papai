// .opencode/plugins/tdd-enforcement.ts
// OpenCode plugin — TDD enforcement following PIPELINES.md specification
// Delegates to .hooks/tdd/checks/* for all check implementations

import type { Plugin } from '@opencode-ai/plugin'

import { enforceTdd } from '../../.hooks/tdd/checks/enforce-tdd.mjs'
import { snapshotSurface } from '../../.hooks/tdd/checks/snapshot-surface.mjs'
import { trackTestWrite } from '../../.hooks/tdd/checks/track-test-write.mjs'
import { verifyNoNewSurface } from '../../.hooks/tdd/checks/verify-no-new-surface.mjs'
import { verifyTestsPass } from '../../.hooks/tdd/checks/verify-tests-pass.mjs'
import { getSessionBaseline } from '../../.hooks/tdd/coverage-session.mjs'

// OpenCode edit tools that use filePath
const EDIT_TOOLS = new Set(['write', 'edit', 'multiedit'])

export const TddEnforcement: Plugin = async ({ client, directory }) => {
  return {
    // PRE-WRITE HOOK (runs before Write/Edit/MultiEdit)
    'tool.execute.before': async (input, output) => {
      // Only process edit tools
      if (!EDIT_TOOLS.has(input.tool)) return

      const filePath = output.args.filePath as string
      if (!filePath) return

      // Capture coverage baseline BEFORE any edits to ensure it reflects the
      // pre-edit state, not the state after the first edit (fixes lazy capture bug)
      getSessionBaseline(input.sessionID, directory)

      // Delegate to hook checks with OpenCode-compatible context shape
      const ctx = {
        tool_input: { file_path: filePath },
        session_id: input.sessionID,
        cwd: directory,
      }

      // [1] enforceTdd - Block impl writes without test
      const tddResult = enforceTdd(ctx)
      if (tddResult) {
        throw new Error(tddResult.reason)
      }

      // [2] snapshotSurface - Capture pre-edit state
      try {
        snapshotSurface(ctx)
      } catch {
        // Fail open - don't block on snapshot errors
      }
    },

    // POST-WRITE HOOK (runs after Write/Edit/MultiEdit)
    'tool.execute.after': async (input) => {
      if (!EDIT_TOOLS.has(input.tool)) return

      const filePath = input.args.filePath as string
      if (!filePath) return

      // Delegate to hook checks with OpenCode-compatible context shape
      const ctx = {
        tool_input: { file_path: filePath },
        session_id: input.sessionID,
        cwd: directory,
      }

      // [4] trackTestWrite - Record test files written this session
      trackTestWrite(ctx)

      // [5] verifyTestsPass - Run tests and check coverage
      const testResult = await verifyTestsPass(ctx)
      if (testResult) {
        void client.session.promptAsync({
          path: { id: input.sessionID },
          body: {
            parts: [{ type: 'text', text: testResult.reason }],
          },
        })
        return
      }

      // [6] verifyNoNewSurface - Only run for gateable impl files (not test files)
      const surfaceResult = verifyNoNewSurface(ctx)
      if (surfaceResult) {
        void client.session.promptAsync({
          path: { id: input.sessionID },
          body: {
            parts: [{ type: 'text', text: surfaceResult.reason }],
          },
        })
        return
      }
    },
  }
}
