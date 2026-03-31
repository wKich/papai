// PostToolUse orchestrator — runs checks sequentially with short-circuit logic

import fs from 'node:fs'

import { trackTestWrite } from '../../.hooks/tdd/checks/track-test-write.mjs'
import { verifyNoNewSurface } from '../../.hooks/tdd/checks/verify-no-new-surface.mjs'
import { verifyTestsPass } from '../../.hooks/tdd/checks/verify-tests-pass.mjs'

try {
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))

  // 1. Record test file writes (side-effect only, always runs)
  trackTestWrite(ctx)

  // 2. Run tests — if RED, skip surface check
  const testResult = await verifyTestsPass(ctx)
  if (testResult) {
    console.log(JSON.stringify(testResult))
    process.exit(0)
  }

  // 3. Verify no new functionality (surface only)
  // Note: Mutation testing now runs at session start/end, not per-file
  const surfaceResult = verifyNoNewSurface(ctx)

  if (surfaceResult) {
    console.log(JSON.stringify(surfaceResult))
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
