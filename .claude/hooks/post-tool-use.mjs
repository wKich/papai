// PostToolUse orchestrator — runs checks sequentially with short-circuit logic

import fs from 'node:fs'

import { trackTestWrite } from '../../.hooks/tdd/checks/track-test-write.mjs'
import { verifyNoNewMutants } from '../../.hooks/tdd/checks/verify-no-new-mutants.mjs'
import { verifyNoNewSurface } from '../../.hooks/tdd/checks/verify-no-new-surface.mjs'
import { verifyTestsPass } from '../../.hooks/tdd/checks/verify-tests-pass.mjs'

try {
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))

  // 1. Record test file writes (side-effect only, always runs)
  trackTestWrite(ctx)

  // 2. Run tests — if RED, skip surface and mutation checks
  const testResult = await verifyTestsPass(ctx)
  if (testResult) {
    console.log(JSON.stringify(testResult))
    process.exit(0)
  }

  // 3. Verify no new functionality (surface + mutants)
  const surfaceResult = verifyNoNewSurface(ctx)
  const mutantResult = verifyNoNewMutants(ctx)

  if (surfaceResult && mutantResult) {
    console.log(
      JSON.stringify({
        decision: 'block',
        reason: surfaceResult.reason + '\n\n---\n\n' + mutantResult.reason,
      }),
    )
  } else if (surfaceResult || mutantResult) {
    console.log(JSON.stringify(surfaceResult || mutantResult))
  }
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
