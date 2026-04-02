// Run `bun check:full` — shared across Claude and OpenCode

import { execFileSync } from 'node:child_process'

/**
 * @typedef {Object} BlockResult
 * @property {'block'} decision
 * @property {string} reason
 */

/**
 * @param {{ cwd: string }} ctx
 * @returns {BlockResult | null}
 */
export function checkFull(ctx) {
  try {
    const { cwd } = ctx
    execFileSync('bun', ['run', 'check:full', '|', 'tail', '-n', '10'], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 300_000,
    })
    return null
  } catch (err) {
    const output = err instanceof Error && 'stdout' in err ? (err.stdout ?? '') : ''
    const stderr = err instanceof Error && 'stderr' in err ? (err.stderr ?? '') : ''
    const message = output || stderr || (err instanceof Error ? err.message : String(err))

    return {
      decision: 'block',
      reason:
        '🔍 Check Issues Detected\n\n' +
        '`bun check:full` failed. Please fix the issues before stopping.\n\n' +
        '```\n' +
        message +
        '\n```\n\n' +
        'Next step: Run `bun fix` to auto-fix issues, or fix manually',
    }
  }
}
