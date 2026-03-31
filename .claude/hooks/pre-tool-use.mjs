// PreToolUse orchestrator — runs checks sequentially with short-circuit logic

import fs from 'node:fs'

import { enforceTdd } from '../../.hooks/tdd/checks/enforce-tdd.mjs'
import { snapshotMutants } from '../../.hooks/tdd/checks/snapshot-mutants.mjs'
import { snapshotSurface } from '../../.hooks/tdd/checks/snapshot-surface.mjs'

try {
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))

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
} catch {
  // Fail open
}

process.exit(0)
