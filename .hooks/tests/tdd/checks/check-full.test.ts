import { describe, expect, test } from 'bun:test'

import { formatCheckResult } from '../../../tdd/checks/check-full.mjs'

describe('formatCheckResult', () => {
  test('formats single failure', () => {
    const result = formatCheckResult([{ check: 'lint', files: ['src/foo.ts', 'src/bar.ts'] }])
    expect(result).toBe(
      '`bun check:full` found issues. Fix before stopping:\n\n' +
        '- lint: 2 files (src/foo.ts, src/bar.ts)\n\n' +
        'Run `bun check:full` for details.',
    )
  })

  test('formats multiple failures', () => {
    const result = formatCheckResult([
      { check: 'lint', files: ['src/a.ts'] },
      { check: 'typecheck', files: ['src/b.ts'] },
      { check: 'test', files: ['tests/c.test.ts', 'tests/d.test.ts'] },
    ])
    expect(result).toBe(
      '`bun check:full` found issues. Fix before stopping:\n\n' +
        '- lint: 1 file (src/a.ts)\n' +
        '- typecheck: 1 file (src/b.ts)\n' +
        '- test: 2 files (tests/c.test.ts, tests/d.test.ts)\n\n' +
        'Run `bun check:full` for details.',
    )
  })

  test('formats failure with no parseable files', () => {
    const result = formatCheckResult([{ check: 'knip', files: [] }])
    expect(result).toBe(
      '`bun check:full` found issues. Fix before stopping:\n\n' +
        '- knip: issues found (no file paths detected)\n\n' +
        'Run `bun check:full` for details.',
    )
  })
})
