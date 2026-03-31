// Session Stop hook - runs mutation verification at session end
// Captures final mutation state and compares against baseline

import fs from 'node:fs'

import { verifySessionMutationBaseline } from '../../.hooks/tdd/session-mutation.mjs'

try {
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))

  // Run session-level mutation verification
  // This compares final state against baseline captured at session start
  verifySessionMutationBaseline(ctx)
} catch (err) {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'Session stop hook failed',
      error: err instanceof Error ? err.message : String(err),
    }),
  )
  // Fail open - don't block session stop
}

process.exit(0)
