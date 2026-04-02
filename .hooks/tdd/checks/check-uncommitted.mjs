// Check for uncommitted git changes — shared across Claude and OpenCode

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
export function checkUncommitted(ctx) {
  try {
    const { cwd } = ctx
    const output = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })
    const changes = output.trim()

    if (!changes) return null

    return {
      decision: 'block',
      reason:
        '📝 Uncommitted Changes Detected\n\n' +
        'You have uncommitted changes. Please commit them before stopping.\n\n' +
        '```\n' +
        changes +
        '\n```\n\n' +
        'Next step: Commit your changes using git add + git commit',
    }
  } catch {
    return null
  }
}
