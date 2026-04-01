// Session Start hook - captures mutation baseline at session start
// This runs when a session starts, resumes, or after /clear or compaction

import fs from 'node:fs'

import { captureSessionMutationBaseline } from '../../.hooks/tdd/session-mutation.mjs'

try {
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))

  // Skip baseline capture for:
  // - Subagents (has agent_id)
  // - Resume (source === 'resume')
  // - Compaction (source === 'compact')
  // Capture on:
  // - Fresh startup (source === 'startup')
  // - After clear command (source === 'clear') - new context, needs fresh baseline
  const isSubagent = ctx.agent_id !== undefined
  const shouldCapture = ctx.source === 'startup' || ctx.source === 'clear'

  if (!isSubagent && shouldCapture) {
    // Capture session-level mutation baseline
    // This runs Stryker on all src/**/*.ts files and records surviving mutants
    captureSessionMutationBaseline(ctx)
  }

  process.exit(0)
} catch (err) {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'Session start hook failed',
      error: err instanceof Error ? err.message : String(err),
    }),
  )
  // Fail open - mutation testing is optional
  process.exit(0)
}
