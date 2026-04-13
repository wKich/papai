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
          locations: [{ path: 'src/message-queue/queue.ts' }],
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

    expect(
      decidePermissionOptionId(
        {
          title: 'Git status with irregular whitespace',
          kind: 'execute',
          locations: [],
          rawInput: { command: '   git\t\tstatus   ' },
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
          locations: [{ path: '../tmp/file.ts' }],
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

    expect(
      decidePermissionOptionId(
        {
          title: 'Chained command',
          kind: 'execute',
          locations: [],
          rawInput: {
            command: 'bun test tests/review-loop/loop-controller.test.ts --reporter=dot && git reset --hard HEAD',
          },
          options,
        },
        '/repo',
      ),
    ).toBe('reject-once')

    expect(
      decidePermissionOptionId(
        {
          title: 'Format outside repo',
          kind: 'execute',
          locations: [],
          rawInput: { command: 'oxfmt /tmp/file.ts' },
          options,
        },
        '/repo',
      ),
    ).toBe('reject-once')

    expect(
      decidePermissionOptionId(
        {
          title: 'Quoted outside repo path',
          kind: 'execute',
          locations: [],
          rawInput: { command: 'oxfmt "/tmp/file.ts"' },
          options,
        },
        '/repo',
      ),
    ).toBe('reject-once')

    expect(
      decidePermissionOptionId(
        {
          title: 'External config path',
          kind: 'execute',
          locations: [],
          rawInput: { command: 'bun test --config=/tmp/evil.config.ts' },
          options,
        },
        '/repo',
      ),
    ).toBe('reject-once')
  })

  test('prefers one-time permissions and rejects pathless reads or edits', () => {
    const mixedOptions = [
      { optionId: 'allow-always', kind: 'allow_always' as const },
      { optionId: 'allow-once', kind: 'allow_once' as const },
      { optionId: 'reject-always', kind: 'reject_always' as const },
      { optionId: 'reject-once', kind: 'reject_once' as const },
    ]

    expect(
      decidePermissionOptionId(
        {
          title: 'Edit queue.ts',
          kind: 'edit',
          locations: [{ path: '/repo/src/message-queue/queue.ts' }],
          rawInput: {},
          options: mixedOptions,
        },
        '/repo',
      ),
    ).toBe('allow-once')

    expect(
      decidePermissionOptionId(
        {
          title: 'Read unknown path',
          kind: 'read',
          locations: [],
          rawInput: {},
          options: mixedOptions,
        },
        '/repo',
      ),
    ).toBe('reject-once')
  })
})
