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
import { captureSessionMutationBaseline, verifySessionMutationBaseline } from '../../.hooks/tdd/session-mutation.mjs'

// Track which sessions have had baseline captured (to detect resumes)
// This is stored in memory per process, so it resets when opencode restarts
const sessionsWithBaseline = new Set<string>()

// Commands that should trigger a fresh baseline capture (equivalent to Claude's `/clear`)
const CLEAR_COMMANDS = new Set(['clear', 'reset'])

// OpenCode edit tools that use filePath
const EDIT_TOOLS = new Set(['write', 'edit', 'multiedit'])

export const TddEnforcement: Plugin = async ({ client, directory }) => {
  return {
    // SESSION EVENTS - Capture baseline on creation, verify on stop
    event: async ({ event }) => {
      if (event.type === 'session.created') {
        const sessionId = event.properties.info.id
        const isSubagent = event.properties.info.parentID !== undefined
        const isResume = sessionsWithBaseline.has(sessionId)

        // Skip baseline capture for:
        // - Subagents (has parentID)
        // - Resumed sessions (already captured baseline before)
        // Capture on:
        // - Fresh parent sessions
        if (!isSubagent && !isResume) {
          sessionsWithBaseline.add(sessionId)
          captureSessionMutationBaseline({
            session_id: sessionId,
            cwd: directory,
          })
        }
      }

      if (event.type === 'session.idle') {
        const sessionId = event.properties.sessionID

        // Only verify if we have a baseline for this session
        // verifySessionMutationBaseline will return early if no baseline exists
        try {
          // Run session-level mutation verification
          // This compares final state against baseline captured at session start
          verifySessionMutationBaseline({
            session_id: sessionId,
            cwd: directory,
          })
          // Success - no new mutants, allow session to stop
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)

          // Format the same prompt message as Claude's session-stop.mjs
          const promptMessage = [
            '🧬 Survived Mutants Regression',
            '',
            'Survived mutants after changes exceed the baseline.',
            'Current code has more untested paths than at session start.',
            '',
            errorMessage,
            '',
            'Fix: Write tests to kill the new surviving mutants.',
          ].join('\n')

          // Prompt agent to continue and fix the regression
          await client.session.prompt({
            path: { id: sessionId },
            body: {
              parts: [{ type: 'text', text: promptMessage }],
            },
          })
        }
      }

      // Detect clear/reset commands and capture fresh baseline
      if (event.type === 'command.executed') {
        const commandName = event.properties.name
        const sessionId = event.properties.sessionID
        if (CLEAR_COMMANDS.has(commandName)) {
          captureSessionMutationBaseline({
            session_id: sessionId,
            cwd: directory,
          })
        }
      }
    },

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
