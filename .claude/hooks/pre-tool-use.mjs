// PreToolUse orchestrator — runs checks sequentially with short-circuit logic

import fs from 'node:fs'
import path from 'node:path'

import { enforceTdd } from '../../.hooks/tdd/checks/enforce-tdd.mjs'
import { snapshotSurface } from '../../.hooks/tdd/checks/snapshot-surface.mjs'
import { getSessionBaseline } from '../../.hooks/tdd/coverage-session.mjs'
import { getSessionsDir } from '../../.hooks/tdd/paths.mjs'
import { captureSessionMutationBaseline } from '../../.hooks/tdd/session-mutation.mjs'

try {
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))

  // Capture coverage baseline BEFORE any edits to ensure it reflects the
  // pre-edit state, not the state after the first edit (fixes lazy capture bug)
  getSessionBaseline(ctx.session_id, ctx.cwd)

  // Capture mutation baseline on first tool use (Claude has no SessionStart hook)
  // We check if baseline file exists to avoid re-running
  const sessionsDir = getSessionsDir(ctx.cwd)
  const baselineFile = path.join(sessionsDir, `tdd-session-mutation-baseline-${ctx.session_id}.json`)
  if (!fs.existsSync(baselineFile)) {
    captureSessionMutationBaseline(ctx)
  }

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

  // 2. Surface snapshot — only worthwhile if the write will proceed
  // Note: Mutation testing now runs at session start/end, not per-file
  snapshotSurface(ctx)
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
