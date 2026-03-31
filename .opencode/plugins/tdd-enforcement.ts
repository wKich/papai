// .opencode/plugins/tdd-enforcement.ts
// OpenCode plugin — TDD enforcement following PIPELINES.md specification
// Delegates to .hooks/tdd/checks/* for all check implementations

import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from '@opencode-ai/plugin'

import { enforceTdd } from '../../.hooks/tdd/checks/enforce-tdd.mjs'
import { snapshotSurface } from '../../.hooks/tdd/checks/snapshot-surface.mjs'
import { trackTestWrite } from '../../.hooks/tdd/checks/track-test-write.mjs'
import { verifyNoNewSurface } from '../../.hooks/tdd/checks/verify-no-new-surface.mjs'
import { verifyTestsPass } from '../../.hooks/tdd/checks/verify-tests-pass.mjs'
import { getSessionsDir } from '../../.hooks/tdd/paths.mjs'
import { captureSessionMutationBaseline, verifySessionMutationBaseline } from '../../.hooks/tdd/session-mutation.mjs'

// OpenCode edit tools that use filePath
const EDIT_TOOLS = new Set(['write', 'edit', 'multiedit'])

export const TddEnforcement: Plugin = async ({ directory }) => {
  const sessionsDir = getSessionsDir(directory)

  return {
    // SESSION STOP - Verify no new mutants (blocks if violations found)
    'session.stop': (input: { sessionID: string }) => {
      verifySessionMutationBaseline({ session_id: input.sessionID, cwd: directory })
    },

    // PRE-WRITE HOOK (runs before Write/Edit/MultiEdit)
    'tool.execute.before': async (input, output) => {
      // Only process edit tools
      if (!EDIT_TOOLS.has(input.tool)) return

      const filePath = output.args.filePath as string
      if (!filePath) return

      // Capture mutation baseline on first tool use (lazy, mirrors Claude hooks)
      const baselineFile = path.join(sessionsDir, `tdd-session-mutation-baseline-${input.sessionID}.json`)
      if (!fs.existsSync(baselineFile)) {
        captureSessionMutationBaseline({ session_id: input.sessionID, cwd: directory })
      }

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
        await snapshotSurface(ctx)
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
        throw new Error(testResult.reason)
      }

      // [6] verifyNoNewSurface - Only run for gateable impl files (not test files)
      const surfaceResult = verifyNoNewSurface(ctx)
      if (surfaceResult) {
        throw new Error(surfaceResult.reason)
      }
    },
  }
}
