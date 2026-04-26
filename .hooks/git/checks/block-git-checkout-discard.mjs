// Blocks any bash command containing `git checkout --`
//
// `git checkout -- <path>` discards uncommitted working-tree changes permanently.
// Agents must not destroy work that may have taken significant effort to produce.
// Instead, preserve changes by committing them to a temporary branch:
//   git checkout -b tmp/recovery && git add -A && git commit -m "wip: preserve before rework"

/**
 * @typedef {Object} BlockResult
 * @property {'block'} decision
 * @property {string} reason
 */

/**
 * @param {{ tool_name?: string, tool_input: Record<string, unknown> }} ctx
 * @returns {BlockResult | null}
 */
export function blockGitCheckoutDiscard(ctx) {
  const toolName = (ctx.tool_name ?? '').toLowerCase()
  if (toolName !== 'bash') return null

  const command = typeof ctx.tool_input.command === 'string' ? ctx.tool_input.command : ''
  if (/\bgit\s+checkout\s+--/u.test(command)) {
    return {
      decision: 'block',
      reason:
        'git checkout -- is not allowed. To discard changes, commit them to a temporary branch instead: git checkout -b tmp/recovery && git add -A && git commit -m "wip: preserve before rework"',
    }
  }

  return null
}
