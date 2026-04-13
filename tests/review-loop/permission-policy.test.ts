import { describe, expect, test } from 'bun:test'

import { decidePermissionOptionId } from '../../scripts/review-loop/permission-policy.js'

const options = [
  { optionId: 'allow-once', kind: 'allow_once' as const },
  { optionId: 'reject-once', kind: 'reject_once' as const },
]

describe('decidePermissionOptionId', () => {
  test('allows repo-local edits and safe execute commands', () => {
    expect(
      decidePermissionOptionId(
        {
          title: 'Edit queue.ts',
          kind: 'edit',
          locations: [{ path: '/repo/src/message-queue/queue.ts' }],
          rawInput: {},
          options,
        },
        '/repo',
      ),
    ).toBe('allow-once')

    expect(
      decidePermissionOptionId(
        {
          title: 'Run tests',
          kind: 'execute',
          locations: [],
          rawInput: { command: 'bun test tests/review-loop/loop-controller.test.ts --reporter=dot' },
          options,
        },
        '/repo',
      ),
    ).toBe('allow-once')
  })

  test('rejects writes outside the repo and destructive commands', () => {
    expect(
      decidePermissionOptionId(
        {
          title: 'Edit /tmp/file.ts',
          kind: 'edit',
          locations: [{ path: '/tmp/file.ts' }],
          rawInput: {},
          options,
        },
        '/repo',
      ),
    ).toBe('reject-once')

    expect(
      decidePermissionOptionId(
        {
          title: 'Reset repo',
          kind: 'execute',
          locations: [],
          rawInput: { command: 'git reset --hard HEAD' },
          options,
        },
        '/repo',
      ),
    ).toBe('reject-once')
  })
})
