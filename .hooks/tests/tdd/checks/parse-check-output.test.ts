import { describe, expect, test } from 'bun:test'

import { parseCheckOutput } from '../../../tdd/checks/parse-check-output.mjs'

describe('parseCheckOutput', () => {
  test('returns null for empty output', () => {
    expect(parseCheckOutput('')).toBeNull()
  })

  test('returns null when all checks pass', () => {
    const output = [
      '',
      'Summary of executed checks:',
      '✓ lint',
      '✓ typecheck',
      '✓ format:check',
      '✓ knip',
      '✓ test',
      '✓ test:client',
      '✓ duplicates',
      '',
      '7/7 checks passed, 0 failed',
    ].join('\n')
    expect(parseCheckOutput(output)).toBeNull()
  })

  test('extracts single failed check with files', () => {
    const output = [
      '✗ lint failed (exit code 1):',
      '---',
      'src/foo.ts:10:5  Error: Unexpected any. (no-implicit-any)',
      'src/bar.ts:20:1  Error: Unused variable. (no-unused-vars)',
      '---',
      '',
      'Summary of executed checks:',
      '✗ lint',
      '',
      '0/1 checks passed, 1 failed',
    ].join('\n')
    const result = parseCheckOutput(output)
    expect(result).not.toBeNull()
    expect(result).toEqual([{ check: 'lint', files: ['src/bar.ts', 'src/foo.ts'] }])
  })

  test('extracts multiple failed checks', () => {
    const output = [
      '✗ lint failed (exit code 1):',
      '---',
      'src/a.ts:1:1  Error',
      '---',
      '✗ typecheck failed (exit code 1):',
      '---',
      'src/b.ts(10,5): error TS2345: Argument of type',
      '---',
      '',
      'Summary of executed checks:',
      '✗ lint',
      '✗ typecheck',
      '',
      '0/2 checks passed, 2 failed',
    ].join('\n')
    const result = parseCheckOutput(output)
    expect(result).toEqual([
      { check: 'lint', files: ['src/a.ts'] },
      { check: 'typecheck', files: ['src/b.ts'] },
    ])
  })

  test('deduplicates files within a check', () => {
    const output = [
      '✗ lint failed (exit code 1):',
      '---',
      'src/foo.ts:1:1  Error 1',
      'src/foo.ts:2:1  Error 2',
      'src/bar.ts:3:1  Error 3',
      '---',
      '',
      'Summary of executed checks:',
      '✗ lint',
      '',
      '0/1 checks passed, 1 failed',
    ].join('\n')
    const result = parseCheckOutput(output)
    expect(result).toEqual([{ check: 'lint', files: ['src/bar.ts', 'src/foo.ts'] }])
  })

  test('handles failed check with no parseable files', () => {
    const output = [
      '✗ knip failed (exit code 1):',
      '---',
      'Unused exports:',
      '  some-symbol',
      '---',
      '',
      'Summary of executed checks:',
      '✗ knip',
      '',
      '0/1 checks passed, 1 failed',
    ].join('\n')
    const result = parseCheckOutput(output)
    expect(result).toEqual([{ check: 'knip', files: [] }])
  })

  test('handles test failures with file paths in bun test output', () => {
    const output = [
      '✗ test failed (exit code 1):',
      '---',
      '✗ tests/unit/foo.test.ts > foo > should work',
      '✗ tests/unit/bar.test.ts > bar > should fail',
      '---',
      '',
      'Summary of executed checks:',
      '✗ test',
      '',
      '0/1 checks passed, 1 failed',
    ].join('\n')
    const result = parseCheckOutput(output)
    expect(result).toEqual([{ check: 'test', files: ['tests/unit/bar.test.ts', 'tests/unit/foo.test.ts'] }])
  })
})
