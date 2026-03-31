import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runTest } from '../../tdd/test-runner.mjs'

describe('runTest', () => {
  let tempDir: string

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('returns passed=true for a passing test', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdd-runner-'))
    const testFile = path.join(tempDir, 'passing.test.ts')
    fs.writeFileSync(
      testFile,
      `import { test, expect } from 'bun:test'\ntest('passes', () => { expect(1 + 1).toBe(2) })\n`,
    )

    const result = await runTest(testFile, tempDir)

    expect(result.passed).toBe(true)
    expect(result.output).toBeDefined()
  })

  test('returns passed=false with error output for a failing test', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdd-runner-'))
    const testFile = path.join(tempDir, 'failing.test.ts')
    fs.writeFileSync(testFile, `import { test, expect } from 'bun:test'\ntest('fails', () => { expect(1).toBe(2) })\n`)

    const result = await runTest(testFile, tempDir)

    expect(result.passed).toBe(false)
    expect(result.output.length).toBeGreaterThan(0)
  })

  test('returns passed=false for a non-existent test file', async () => {
    const result = await runTest('/nonexistent/test.ts', '/tmp')

    expect(result.passed).toBe(false)
  })

  test('truncates output to at most 3000 characters', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdd-runner-'))
    const testFile = path.join(tempDir, 'passing.test.ts')
    fs.writeFileSync(
      testFile,
      `import { test, expect } from 'bun:test'\ntest('passes', () => { expect(1 + 1).toBe(2) })\n`,
    )

    const result = await runTest(testFile, tempDir)

    expect(result.output.length).toBeLessThanOrEqual(3000)
  })
})
