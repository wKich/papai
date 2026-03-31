// Session Stop hook - runs mutation verification at session end
// Captures final mutation state and compares against baseline
// Blocks session termination if new untested code paths are detected

import fs from 'node:fs'

import { verifySessionMutationBaseline } from '../../.hooks/tdd/session-mutation.mjs'

try {
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))

  // Run session-level mutation verification
  // This compares final state against baseline captured at session start
  verifySessionMutationBaseline(ctx)

  // Success - no new mutants
  process.exit(0)
} catch (err) {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'Session stop blocked: mutation testing violations detected',
      error: err instanceof Error ? err.message : String(err),
    }),
  )
  // Block session stop - exit with error code
  process.exit(1)
}
