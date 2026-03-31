// PreToolUse orchestrator — runs checks sequentially with short-circuit logic

import fs from 'node:fs'

import { enforceTdd } from '../../.hooks/tdd/checks/enforce-tdd.mjs'
import { snapshotMutants } from '../../.hooks/tdd/checks/snapshot-mutants.mjs'
import { snapshotSurface } from '../../.hooks/tdd/checks/snapshot-surface.mjs'
import { getSessionBaseline } from '../../.hooks/tdd/coverage-session.mjs'

try {
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))

  // Capture coverage baseline BEFORE any edits to ensure it reflects the
  // pre-edit state, not the state after the first edit (fixes lazy capture bug)
  getSessionBaseline(ctx.session_id, ctx.cwd)

  // 1. TDD gate — if blocked, skip snapshotting (the write won't proceed)
  const gate = enforceTdd(ctx)
  if (gate) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: gate.reason,
        },
      }),
    )
    process.exit(0)
  }

  // 2. Snapshots — only worthwhile if the write will proceed
  snapshotSurface(ctx)
  snapshotMutants(ctx)
} catch (err) {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'Hook execution failed',
      error: err instanceof Error ? err.message : String(err),
    }),
  )
  // Fail open
}

process.exit(0)
