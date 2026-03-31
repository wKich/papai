import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { isTestFile, isGateableImplFile, suggestTestPath, findTestFile } from '../../tdd/test-resolver.mjs'

describe('test-resolver', () => {
  describe('isTestFile', () => {
    test('returns true for .test.ts', () => {
      expect(isTestFile('src/config.test.ts')).toBe(true)
    })

    test('returns true for .test.js', () => {
      expect(isTestFile('lib/utils.test.js')).toBe(true)
    })

    test('returns true for .spec.ts', () => {
      expect(isTestFile('tests/foo.spec.ts')).toBe(true)
    })

    test('returns true for .spec.tsx', () => {
      expect(isTestFile('components/Button.spec.tsx')).toBe(true)
    })

    test('returns true for .test.jsx', () => {
      expect(isTestFile('components/Card.test.jsx')).toBe(true)
    })

    test('returns false for .ts', () => {
      expect(isTestFile('src/config.ts')).toBe(false)
    })

    test('returns false for .js', () => {
      expect(isTestFile('src/utils.js')).toBe(false)
    })

    test('returns false for plain filenames', () => {
      expect(isTestFile('Makefile')).toBe(false)
    })

    test('returns false for .md files', () => {
      expect(isTestFile('README.md')).toBe(false)
    })
  })

  describe('isGateableImplFile', () => {
    const projectRoot = '/project'

    test('returns true for src/config.ts', () => {
      expect(isGateableImplFile('src/config.ts', projectRoot)).toBe(true)
    })

    test('returns true for src/providers/kaneo/client.ts', () => {
      expect(isGateableImplFile('src/providers/kaneo/client.ts', projectRoot)).toBe(true)
    })

    test('returns false for test files outside src', () => {
      expect(isGateableImplFile('tests/config.test.ts', projectRoot)).toBe(false)
    })

    test('returns false for non-src paths', () => {
      expect(isGateableImplFile('docs/readme.md', projectRoot)).toBe(false)
    })

    test('returns false for test files in src', () => {
      expect(isGateableImplFile('src/foo.test.ts', projectRoot)).toBe(false)
    })

    test('returns false for non-code files in src', () => {
      expect(isGateableImplFile('src/data.json', projectRoot)).toBe(false)
    })

    test('returns false for CSS files in src', () => {
      expect(isGateableImplFile('src/style.css', projectRoot)).toBe(false)
    })
  })

  describe('suggestTestPath', () => {
    test('src/config.ts -> tests/config.test.ts', () => {
      expect(suggestTestPath('src/config.ts')).toBe('tests/config.test.ts')
    })

    test('src/providers/kaneo/client.ts -> tests/providers/kaneo/client.test.ts', () => {
      expect(suggestTestPath('src/providers/kaneo/client.ts')).toBe('tests/providers/kaneo/client.test.ts')
    })

    test('src/utils/format.tsx -> tests/utils/format.test.tsx', () => {
      expect(suggestTestPath('src/utils/format.tsx')).toBe('tests/utils/format.test.tsx')
    })
  })

  describe('findTestFile', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-resolver-'))
    })

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    test('finds test file in parallel tests/ directory', () => {
      const testsDir = path.join(tmpDir, 'tests')
      fs.mkdirSync(testsDir, { recursive: true })
      const testFile = path.join(testsDir, 'foo.test.ts')
      fs.writeFileSync(testFile, '')

      const implFile = path.join(tmpDir, 'src', 'foo.ts')
      const result = findTestFile(implFile, tmpDir)

      expect(result).toBe(testFile)
    })

    test('finds .spec.ts test file in nested directory', () => {
      const testsDir = path.join(tmpDir, 'tests', 'deep')
      fs.mkdirSync(testsDir, { recursive: true })
      const testFile = path.join(testsDir, 'bar.spec.ts')
      fs.writeFileSync(testFile, '')

      const implFile = path.join(tmpDir, 'src', 'deep', 'bar.ts')
      const result = findTestFile(implFile, tmpDir)

      expect(result).toBe(testFile)
    })

    test('returns null when no test file exists', () => {
      const implFile = path.join(tmpDir, 'src', 'missing.ts')
      const result = findTestFile(implFile, tmpDir)

      expect(result).toBeNull()
    })

    test('finds colocated test file as fallback', () => {
      const srcDir = path.join(tmpDir, 'src')
      fs.mkdirSync(srcDir, { recursive: true })
      fs.writeFileSync(path.join(srcDir, 'baz.ts'), '')
      const colocatedTest = path.join(srcDir, 'baz.test.ts')
      fs.writeFileSync(colocatedTest, '')

      const implFile = path.join(tmpDir, 'src', 'baz.ts')
      const result = findTestFile(implFile, tmpDir)

      expect(result).toBe(colocatedTest)
    })

    test('returns null for non-src file without colocated test', () => {
      const libDir = path.join(tmpDir, 'lib')
      fs.mkdirSync(libDir, { recursive: true })
      const implFile = path.join(libDir, 'util.ts')
      const result = findTestFile(implFile, tmpDir)

      expect(result).toBeNull()
    })
  })
})
