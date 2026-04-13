import { describe, expect, test } from 'bun:test'

import { resolveInvocationText } from '../../scripts/review-loop/available-commands.js'

describe('resolveInvocationText', () => {
  test('uses the slash command prefix only when the command is advertised', () => {
    expect(resolveInvocationText('/verify-issue', ['verify-issue'], 'Issue body', false)).toBe(
      '/verify-issue Issue body',
    )

    expect(resolveInvocationText('/verify-issue', [], 'Issue body', false)).toBe('Issue body')
  })

  test('throws when a required slash command is missing', () => {
    expect(() => resolveInvocationText('/review-code', [], 'Issue body', true)).toThrow(
      'Required command /review-code is not advertised by the agent',
    )
  })
})
