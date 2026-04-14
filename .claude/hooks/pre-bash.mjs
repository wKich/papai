import fs from 'node:fs'

import { blockGitStash } from '../../.hooks/git/checks/block-git-stash.mjs'

try {
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))

  const result = blockGitStash(ctx)
  if (result) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: result.reason,
        },
      }),
    )
  }
} catch {
  // Fail open
}

process.exit(0)
