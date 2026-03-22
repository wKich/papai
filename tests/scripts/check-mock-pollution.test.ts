import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const SCRIPT = join(import.meta.dirname, '../../scripts/check-mock-pollution.ts')

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Minimal src modules shared across all test runs.
const SRC_FILES: Record<string, string> = {
  'foo.ts': "export const foo = 'foo'",
  'bar.ts': "export const bar = 'bar'",
  // Barrel: index.ts re-exports from sub.ts
  'barrel/index.ts': "export { sub } from './sub.js'",
  'barrel/sub.ts': "export const sub = 'sub'",
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type RunResult = { stdout: string; exitCode: number }

/**
 * Creates a self-contained temp directory, writes src + test files into it,
 * runs the pollution checker script against it, then removes the directory.
 * Using a fresh directory per call prevents cross-test file accumulation.
 */
async function run(testFiles: Record<string, string>, args: string[] = []): Promise<RunResult> {
  const dir = mkdtempSync(join(tmpdir(), 'mock-pollution-test-'))
  try {
    // Write src fixtures
    mkdirSync(join(dir, 'src', 'barrel'), { recursive: true })
    for (const [name, content] of Object.entries(SRC_FILES)) {
      writeFileSync(join(dir, 'src', name), content)
    }
    // Write test files
    mkdirSync(join(dir, 'tests'), { recursive: true })
    for (const [name, content] of Object.entries(testFiles)) {
      writeFileSync(join(dir, 'tests', name), content)
    }

    const proc = Bun.spawn(['bun', SCRIPT, '--root', dir, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = await new Response(proc.stdout).text()
    await proc.exited
    return { stdout, exitCode: proc.exitCode ?? 0 }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('check-mock-pollution — clean files', () => {
  test('no mocks → exits 0 with success message', async () => {
    const { stdout, exitCode } = await run({
      'clean.test.ts': `
        import { test, expect } from 'bun:test'
        import { foo } from '../src/foo.js'
        test('foo', () => expect(foo).toBe('foo'))
      `,
    })
    expect(exitCode).toBe(0)
    expect(stdout).toContain('No mock pollution issues detected')
  })

  test('module mocked only by the file that also imports it → exits 0', async () => {
    const { stdout, exitCode } = await run({
      'self-contained.test.ts': `
        import { mock, test, expect } from 'bun:test'
        void mock.module('../src/foo.js', () => ({ foo: 'mocked' }))
        import { foo } from '../src/foo.js'
        test('foo', () => expect(foo).toBe('mocked'))
      `,
    })
    expect(exitCode).toBe(0)
    expect(stdout).toContain('No mock pollution issues detected')
  })
})

describe('check-mock-pollution — MEDIUM: shared module mocked without cleanup', () => {
  test('default mode: exits 0 with warning', async () => {
    const { stdout, exitCode } = await run({
      'mocker.test.ts': `
        import { mock } from 'bun:test'
        void mock.module('../src/foo.js', () => ({ foo: 'mocked' }))
      `,
      'victim.test.ts': `
        import { foo } from '../src/foo.js'
        import { test } from 'bun:test'
        test('x', () => {})
      `,
    })
    expect(exitCode).toBe(0)
    expect(stdout).toContain('[MEDIUM]')
    expect(stdout).toContain('mocker.test.ts')
    expect(stdout).toContain('victim.test.ts')
  })

  test('--strict mode: exits 1', async () => {
    const { stdout, exitCode } = await run(
      {
        'strict-mocker.test.ts': `
          import { mock } from 'bun:test'
          void mock.module('../src/foo.js', () => ({ foo: 'mocked' }))
        `,
        'strict-victim.test.ts': `
          import { foo } from '../src/foo.js'
          import { test } from 'bun:test'
          test('x', () => {})
        `,
      },
      ['--strict'],
    )
    expect(exitCode).toBe(1)
    expect(stdout).toContain('[MEDIUM]')
  })

  test('afterAll mock.restore() cleanup: not flagged even in --strict mode', async () => {
    const { stdout, exitCode } = await run(
      {
        'clean-mocker.test.ts': `
          import { mock, afterAll } from 'bun:test'
          void mock.module('../src/foo.js', () => ({ foo: 'mocked' }))
          afterAll(() => { mock.restore() })
        `,
        'clean-victim.test.ts': `
          import { foo } from '../src/foo.js'
          import { test } from 'bun:test'
          test('x', () => {})
        `,
      },
      ['--strict'],
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('No mock pollution issues detected')
  })
})

describe('check-mock-pollution — HIGH: barrel mock', () => {
  test('mocking barrel while another file imports its sub-module: exits 1', async () => {
    const { stdout, exitCode } = await run({
      'barrel-mocker.test.ts': `
        import { mock } from 'bun:test'
        void mock.module('../src/barrel/index.js', () => ({ sub: 'mocked' }))
      `,
      'sub-victim.test.ts': `
        import { sub } from '../src/barrel/sub.js'
        import { test } from 'bun:test'
        test('sub', () => {})
      `,
    })
    expect(exitCode).toBe(1)
    expect(stdout).toContain('[HIGH]')
    expect(stdout).toContain('barrel-mocker.test.ts')
    expect(stdout).toContain('sub-victim.test.ts')
  })

  test('barrel mock with afterAll cleanup: still HIGH (cleanup does not fix barrel corruption)', async () => {
    const { stdout, exitCode } = await run({
      'barrel-cleanup-mocker.test.ts': `
        import { mock, afterAll } from 'bun:test'
        void mock.module('../src/barrel/index.js', () => ({ sub: 'mocked' }))
        afterAll(() => { mock.restore() })
      `,
      'barrel-cleanup-victim.test.ts': `
        import { sub } from '../src/barrel/sub.js'
        import { test } from 'bun:test'
        test('sub', () => {})
      `,
    })
    expect(exitCode).toBe(1)
    expect(stdout).toContain('[HIGH]')
  })
})

describe('check-mock-pollution — type-only imports', () => {
  test('type-only import of mocked module is not counted as a victim', async () => {
    const { stdout, exitCode } = await run(
      {
        'type-mocker.test.ts': `
          import { mock } from 'bun:test'
          void mock.module('../src/foo.js', () => ({ foo: 'mocked' }))
        `,
        'type-only.test.ts': `
          import type { foo } from '../src/foo.js'
          import { test } from 'bun:test'
          test('x', () => {})
        `,
      },
      ['--strict'],
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('No mock pollution issues detected')
  })

  test('value import of mocked module IS counted as a victim', async () => {
    const { stdout, exitCode } = await run(
      {
        'value-mocker.test.ts': `
          import { mock } from 'bun:test'
          void mock.module('../src/foo.js', () => ({ foo: 'mocked' }))
        `,
        'value-victim.test.ts': `
          import { foo } from '../src/foo.js'
          import { test } from 'bun:test'
          test('x', () => {})
        `,
      },
      ['--strict'],
    )
    expect(exitCode).toBe(1)
    expect(stdout).toContain('[MEDIUM]')
    expect(stdout).toContain('value-victim.test.ts')
  })
})

// Self-check: the checker must pass on the real project with --strict
describe('check-mock-pollution — self-check on project', () => {
  test('no issues in the real test suite', async () => {
    const proc = Bun.spawn(['bun', SCRIPT, '--strict'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = await new Response(proc.stdout).text()
    await proc.exited
    expect(proc.exitCode).toBe(0)
    expect(stdout).toContain('No mock pollution issues detected')
  })
})
