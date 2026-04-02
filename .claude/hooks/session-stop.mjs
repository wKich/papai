// Session Stop hook - runs comprehensive checks before session end
// 1. Check for uncommitted changes → prompt to commit if any
// 2. Run bun check:full → prompt to fix if issues
// 3. Verify mutation baseline if all checks pass

import fs from 'node:fs'

import { checkFull } from '../../.hooks/tdd/checks/check-full.mjs'
import { checkUncommitted } from '../../.hooks/tdd/checks/check-uncommitted.mjs'
import { verifySessionMutationBaseline } from '../../.hooks/tdd/session-mutation.mjs'

const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
const { cwd } = ctx

try {
  const uncommitted = checkUncommitted({ cwd })

  if (uncommitted) {
    console.log(
      JSON.stringify({
        decision: 'block',
        reason: uncommitted.reason,
      }),
    )
    process.exit(0)
  }

  const checkResult = checkFull({ cwd })

  if (checkResult) {
    console.log(
      JSON.stringify({
        decision: 'block',
        reason: checkResult.reason,
      }),
    )
    process.exit(0)
  }

  const mutationResult = verifySessionMutationBaseline(ctx)

  if (mutationResult) {
    console.log(
      JSON.stringify({
        decision: 'block',
        reason: mutationResult.reason,
      }),
    )
    process.exit(0)
  }

  process.exit(0)
} catch (err) {
  const errorMessage = err instanceof Error ? err.message : String(err)

  console.log(
    JSON.stringify({
      decision: 'block',
      reason: `Session stop hook error: ${errorMessage}`,
    }),
  )
  process.exit(0)
}
