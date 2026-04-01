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

  // Success - no new mutants, allow session to stop
  process.exit(0)
} catch (err) {
  const errorMessage = err instanceof Error ? err.message : String(err)

  // Explain the regression: survived mutants increased since baseline
  const reason = [
    '🧬 Survived Mutants Regression',
    '',
    'Survived mutants after changes exceed the baseline.',
    'Current code has more untested paths than at session start.',
    '',
    errorMessage,
    '',
    'Fix: Write tests to kill the new surviving mutants.'
  ].join('\n')

  // Use JSON Decision Control to block session stop and continue conversation
  // Exit 0 with decision: "block" - Claude Code will prevent stop and show reason
  console.log(
    JSON.stringify({
      decision: 'block',
      reason: reason,
    }),
  )

  process.exit(0)
}
