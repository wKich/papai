// .opencode/plugins/tdd-enforcement.ts
// OpenCode plugin — TDD enforcement following PIPELINES.md specification
// Delegates to .hooks/tdd/checks/* for all check implementations

import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from '@opencode-ai/plugin'

import { enforceTdd } from '../../.hooks/tdd/checks/enforce-tdd.mjs'
import { snapshotSurface } from '../../.hooks/tdd/checks/snapshot-surface.mjs'
import { verifyNoNewSurface } from '../../.hooks/tdd/checks/verify-no-new-surface.mjs'
import { verifyTestsPass } from '../../.hooks/tdd/checks/verify-tests-pass.mjs'
import { getSessionsDir } from '../../.hooks/tdd/paths.mjs'
import {
  captureSessionMutationBaseline as captureBaselineJs,
  verifySessionMutationBaseline as verifyBaselineJs,
} from '../../.hooks/tdd/session-mutation.mjs'
import { SessionState } from '../../.hooks/tdd/session-state.mjs'
import { isTestFile } from '../../.hooks/tdd/test-resolver.mjs'

// OpenCode edit tools that use filePath
const EDIT_TOOLS = new Set(['write', 'edit', 'multiedit'])

export const TddEnforcement: Plugin = async ({ directory }) => {
  const sessionsDir = getSessionsDir(directory)

  return {
    // SESSION START - Capture mutation baseline
    'session.start': (input: { sessionID: string }) => {
      const state = new SessionState(input.sessionID, sessionsDir)
      // Call the shared JS implementation
      captureBaselineJs({ session_id: input.sessionID, cwd: directory })

      // Read the result and store in SessionState
      const baselineFile = path.join(sessionsDir, `tdd-session-mutation-baseline-${input.sessionID}.json`)

      if (fs.existsSync(baselineFile)) {
        const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'))
        state.setSessionMutationBaseline(baseline)
      }
    },

    // SESSION STOP - Verify no new mutants (JS function outputs report to stderr)
    'session.stop': (input: { sessionID: string }) => {
      try {
        verifyBaselineJs({ session_id: input.sessionID, cwd: directory })
      } catch {
        // Fail open - don't block session stop
      }
    },

    // PRE-WRITE HOOK (runs before Write/Edit/MultiEdit)
    'tool.execute.before': async (input) => {
      // Only process edit tools
      if (!EDIT_TOOLS.has(input.tool)) return

      const filePath = (input as unknown as { args: { filePath: string } }).args.filePath
      if (!filePath) return

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

      const state = new SessionState(input.sessionID, sessionsDir)
      const absPath = path.resolve(directory, filePath)

      // [4] trackTestWrite - Record test files written this session
      if (isTestFile(filePath)) {
        state.addWrittenTest(absPath)
      }

      // Delegate to hook checks with OpenCode-compatible context shape
      const ctx = {
        tool_input: { file_path: filePath },
        session_id: input.sessionID,
        cwd: directory,
      }

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
