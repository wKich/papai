import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import path from 'node:path'

import { verifyTestsPass } from '../../../tdd/checks/verify-tests-pass.mjs'

describe('verifyTestsPass', () => {
  const mockFindTestFile = mock()
  const mockIsTestFile = mock()
  const mockIsGateableImplFile = mock()
  const mockRunTest = mock()
  const mockGetCoverage = mock()
  const mockGetSessionBaseline = mock()

  mock.module('../../../tdd/test-resolver.mjs', () => ({
    findTestFile: mockFindTestFile,
    isTestFile: mockIsTestFile,
    isGateableImplFile: mockIsGateableImplFile,
  }))

  mock.module('../../../tdd/test-runner.mjs', () => ({
    runTest: mockRunTest,
  }))

  mock.module('../../../tdd/coverage.mjs', () => ({
    getCoverage: mockGetCoverage,
  }))

  mock.module('../../../tdd/coverage-session.mjs', () => ({
    getSessionBaseline: mockGetSessionBaseline,
  }))

  afterAll(() => {
    mock.restore()
  })

  afterEach(() => {
    mockFindTestFile.mockClear()
    mockIsTestFile.mockClear()
    mockIsGateableImplFile.mockClear()
    mockRunTest.mockClear()
    mockGetCoverage.mockClear()
    mockGetSessionBaseline.mockClear()
  })

  describe('returns null for non-TS/JS files', () => {
    test.each([
      ['README.md', 'markdown file'],
      ['Makefile', 'Makefile'],
      ['.eslintrc.json', 'JSON config'],
      ['config.yaml', 'YAML file'],
      ['src/styles.css', 'CSS file'],
      ['.prettierrc', 'dotfile'],
      ['docs/guide.mdx', 'MDX file'],
      ['assets/logo.png', 'image file'],
    ])('returns null for %s (%s)', async (filePath, _description) => {
      const ctx = {
        tool_input: { file_path: filePath },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toBeNull()
      expect(mockFindTestFile).not.toHaveBeenCalled()
      expect(mockRunTest).not.toHaveBeenCalled()
    })
  })

  describe('returns null when no test file found', () => {
    test('returns null when findTestFile returns null', async () => {
      mockIsTestFile.mockReturnValue(false)
      mockFindTestFile.mockReturnValue(null)

      const ctx = {
        tool_input: { file_path: 'src/utils.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toBeNull()
      expect(mockFindTestFile).toHaveBeenCalledWith(
        path.resolve('/project/src/utils.ts'),
        '/project',
      )
      expect(mockRunTest).not.toHaveBeenCalled()
    })
  })

  describe('returns null when tests pass and coverage OK', () => {
    test('returns null when impl file tests pass with no baseline', async () => {
      const implPath = path.resolve('/project/src/module.ts')
      const testPath = path.resolve('/project/tests/module.test.ts')

      mockIsTestFile.mockReturnValue(false)
      mockFindTestFile.mockReturnValue(testPath)
      mockRunTest.mockResolvedValue({ passed: true, output: '1 pass' })
      mockIsGateableImplFile.mockReturnValue(true)
      mockGetSessionBaseline.mockReturnValue({})

      const ctx = {
        tool_input: { file_path: 'src/module.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toBeNull()
      expect(mockRunTest).toHaveBeenCalledWith(testPath, '/project')
    })

    test('returns null when test file passes', async () => {
      const testPath = path.resolve('/project/tests/module.test.ts')

      mockIsTestFile.mockReturnValue(true)
      mockRunTest.mockResolvedValue({ passed: true, output: '1 pass' })

      const ctx = {
        tool_input: { file_path: 'tests/module.test.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toBeNull()
      expect(mockRunTest).toHaveBeenCalledWith(testPath, '/project')
      expect(mockIsGateableImplFile).not.toHaveBeenCalled()
    })
  })

  describe('blocks when tests fail', () => {
    test('blocks when impl file tests fail', async () => {
      const testPath = path.resolve('/project/tests/module.test.ts')

      mockIsTestFile.mockReturnValue(false)
      mockFindTestFile.mockReturnValue(testPath)
      mockRunTest.mockResolvedValue({
        passed: false,
        output: 'Error: expected 1 to be 2',
      })

      const ctx = {
        tool_input: { file_path: 'src/module.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toEqual({
        decision: 'block',
        reason:
          'Tests failed after editing `src/module.ts`.\n\n' +
          '── Test output ──────────────────────────────\n' +
          'Error: expected 1 to be 2\n' +
          '─────────────────────────────────────────────\n\n' +
          'Next step: Fix the code to make all tests pass.',
      })
    })

    test('blocks when test file fails with different message', async () => {
      const testPath = path.resolve('/project/tests/module.test.ts')

      mockIsTestFile.mockReturnValue(true)
      mockRunTest.mockResolvedValue({
        passed: false,
        output: 'TypeError: Cannot read property of undefined',
      })

      const ctx = {
        tool_input: { file_path: 'tests/module.test.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toEqual({
        decision: 'block',
        reason:
          'Tests failed after writing `tests/module.test.ts`.\n\n' +
          '── Test output ──────────────────────────────\n' +
          'TypeError: Cannot read property of undefined\n' +
          '─────────────────────────────────────────────\n\n' +
          'Next step: Write the implementation to make this test pass.',
      })
    })
  })

  describe('blocks when coverage drops below baseline', () => {
    test('blocks when coverage drops for impl file', async () => {
      const implPath = path.resolve('/project/src/module.ts')
      const testPath = path.resolve('/project/tests/module.test.ts')

      mockIsTestFile.mockReturnValue(false)
      mockFindTestFile.mockReturnValue(testPath)
      mockRunTest.mockResolvedValue({ passed: true, output: '1 pass' })
      mockIsGateableImplFile.mockReturnValue(true)
      mockGetSessionBaseline.mockReturnValue({
        [implPath]: { covered: 8, total: 10 },
      })
      mockGetCoverage.mockReturnValue({ covered: 5, total: 10 })

      const ctx = {
        tool_input: { file_path: 'src/module.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toEqual({
        decision: 'block',
        reason:
          'Code coverage dropped in `src/module.ts`.\n\n' +
          'Before: 80.0% (8/10 lines)\n' +
          'After:  50.0% (5/10 lines), −30.0pp\n\n' +
          'Next step: Write tests to cover the new code paths.',
      })
    })

    test('blocks with small coverage drop', async () => {
      const implPath = path.resolve('/project/src/module.ts')
      const testPath = path.resolve('/project/tests/module.test.ts')

      mockIsTestFile.mockReturnValue(false)
      mockFindTestFile.mockReturnValue(testPath)
      mockRunTest.mockResolvedValue({ passed: true, output: '1 pass' })
      mockIsGateableImplFile.mockReturnValue(true)
      mockGetSessionBaseline.mockReturnValue({
        [implPath]: { covered: 100, total: 100 },
      })
      mockGetCoverage.mockReturnValue({ covered: 99, total: 100 })

      const ctx = {
        tool_input: { file_path: 'src/module.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result?.decision).toBe('block')
      expect(result?.reason).toContain('Code coverage dropped')
      expect(result?.reason).toContain('−1.0pp')
    })
  })

  describe('allows coverage drop when no baseline exists', () => {
    test('allows when baseline is empty object', async () => {
      const testPath = path.resolve('/project/tests/module.test.ts')

      mockIsTestFile.mockReturnValue(false)
      mockFindTestFile.mockReturnValue(testPath)
      mockRunTest.mockResolvedValue({ passed: true, output: '1 pass' })
      mockIsGateableImplFile.mockReturnValue(true)
      mockGetSessionBaseline.mockReturnValue({})

      const ctx = {
        tool_input: { file_path: 'src/module.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toBeNull()
      expect(mockGetCoverage).not.toHaveBeenCalled()
    })

    test('allows when baseline returns null', async () => {
      const testPath = path.resolve('/project/tests/module.test.ts')

      mockIsTestFile.mockReturnValue(false)
      mockFindTestFile.mockReturnValue(testPath)
      mockRunTest.mockResolvedValue({ passed: true, output: '1 pass' })
      mockIsGateableImplFile.mockReturnValue(true)
      mockGetSessionBaseline.mockReturnValue(null)

      const ctx = {
        tool_input: { file_path: 'src/module.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toBeNull()
    })

    test('allows when baseline has different file', async () => {
      const implPath = path.resolve('/project/src/module.ts')
      const testPath = path.resolve('/project/tests/module.test.ts')

      mockIsTestFile.mockReturnValue(false)
      mockFindTestFile.mockReturnValue(testPath)
      mockRunTest.mockResolvedValue({ passed: true, output: '1 pass' })
      mockIsGateableImplFile.mockReturnValue(true)
      mockGetSessionBaseline.mockReturnValue({
        '/project/src/other.ts': { covered: 8, total: 10 },
      })

      const ctx = {
        tool_input: { file_path: 'src/module.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toBeNull()
    })
  })

  describe('handles missing file_path gracefully', () => {
    test('returns null when tool_input.file_path is undefined', async () => {
      const ctx = {
        tool_input: {},
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toBeNull()
    })

    test('returns null when tool_input.file_path is empty string', async () => {
      const ctx = {
        tool_input: { file_path: '' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toBeNull()
    })
  })

  describe('handles runTest errors gracefully (fail open)', () => {
    test('returns null when runTest throws', async () => {
      const testPath = path.resolve('/project/tests/module.test.ts')

      mockIsTestFile.mockReturnValue(false)
      mockFindTestFile.mockReturnValue(testPath)
      mockRunTest.mockRejectedValue(new Error('Test runner crashed'))

      const ctx = {
        tool_input: { file_path: 'src/module.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toBeNull()
    })
  })

  describe('edge cases', () => {
    test('returns null when isGateableImplFile returns false', async () => {
      const testPath = path.resolve('/project/tests/module.test.ts')

      mockIsTestFile.mockReturnValue(false)
      mockFindTestFile.mockReturnValue(testPath)
      mockRunTest.mockResolvedValue({ passed: true, output: '1 pass' })
      mockIsGateableImplFile.mockReturnValue(false)

      const ctx = {
        tool_input: { file_path: 'src/module.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toBeNull()
      expect(mockGetSessionBaseline).not.toHaveBeenCalled()
    })

    test('skips coverage check for test files even if they pass', async () => {
      const testPath = path.resolve('/project/tests/module.test.ts')

      mockIsTestFile.mockReturnValue(true)
      mockRunTest.mockResolvedValue({ passed: true, output: '1 pass' })

      const ctx = {
        tool_input: { file_path: 'tests/module.test.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toBeNull()
      expect(mockIsGateableImplFile).not.toHaveBeenCalled()
      expect(mockGetSessionBaseline).not.toHaveBeenCalled()
    })

    test('allows coverage increase', async () => {
      const implPath = path.resolve('/project/src/module.ts')
      const testPath = path.resolve('/project/tests/module.test.ts')

      mockIsTestFile.mockReturnValue(false)
      mockFindTestFile.mockReturnValue(testPath)
      mockRunTest.mockResolvedValue({ passed: true, output: '1 pass' })
      mockIsGateableImplFile.mockReturnValue(true)
      mockGetSessionBaseline.mockReturnValue({
        [implPath]: { covered: 5, total: 10 },
      })
      mockGetCoverage.mockReturnValue({ covered: 10, total: 10 })

      const ctx = {
        tool_input: { file_path: 'src/module.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toBeNull()
    })

    test('allows same coverage', async () => {
      const implPath = path.resolve('/project/src/module.ts')
      const testPath = path.resolve('/project/tests/module.test.ts')

      mockIsTestFile.mockReturnValue(false)
      mockFindTestFile.mockReturnValue(testPath)
      mockRunTest.mockResolvedValue({ passed: true, output: '1 pass' })
      mockIsGateableImplFile.mockReturnValue(true)
      mockGetSessionBaseline.mockReturnValue({
        [implPath]: { covered: 8, total: 10 },
      })
      mockGetCoverage.mockReturnValue({ covered: 8, total: 10 })

      const ctx = {
        tool_input: { file_path: 'src/module.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toBeNull()
    })

    test('handles when getCoverage returns null', async () => {
      const implPath = path.resolve('/project/src/module.ts')
      const testPath = path.resolve('/project/tests/module.test.ts')

      mockIsTestFile.mockReturnValue(false)
      mockFindTestFile.mockReturnValue(testPath)
      mockRunTest.mockResolvedValue({ passed: true, output: '1 pass' })
      mockIsGateableImplFile.mockReturnValue(true)
      mockGetSessionBaseline.mockReturnValue({
        [implPath]: { covered: 8, total: 10 },
      })
      mockGetCoverage.mockReturnValue(null)

      const ctx = {
        tool_input: { file_path: 'src/module.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toBeNull()
    })

    test('handles when getCoverage returns zero total', async () => {
      const implPath = path.resolve('/project/src/module.ts')
      const testPath = path.resolve('/project/tests/module.test.ts')

      mockIsTestFile.mockReturnValue(false)
      mockFindTestFile.mockReturnValue(testPath)
      mockRunTest.mockResolvedValue({ passed: true, output: '1 pass' })
      mockIsGateableImplFile.mockReturnValue(true)
      mockGetSessionBaseline.mockReturnValue({
        [implPath]: { covered: 8, total: 10 },
      })
      mockGetCoverage.mockReturnValue({ covered: 0, total: 0 })

      const ctx = {
        tool_input: { file_path: 'src/module.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toBeNull()
    })

    test('handles when baseline has zero total', async () => {
      const implPath = path.resolve('/project/src/module.ts')
      const testPath = path.resolve('/project/tests/module.test.ts')

      mockIsTestFile.mockReturnValue(false)
      mockFindTestFile.mockReturnValue(testPath)
      mockRunTest.mockResolvedValue({ passed: true, output: '1 pass' })
      mockIsGateableImplFile.mockReturnValue(true)
      mockGetSessionBaseline.mockReturnValue({
        [implPath]: { covered: 0, total: 0 },
      })

      const ctx = {
        tool_input: { file_path: 'src/module.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toBeNull()
      expect(mockGetCoverage).not.toHaveBeenCalled()
    })

    test('works with various TS/JS file extensions', async () => {
      for (const ext of ['ts', 'js', 'tsx', 'jsx']) {
        mockIsTestFile.mockReturnValue(false)
        mockFindTestFile.mockReturnValue(`/project/tests/module.test.${ext}`)
        mockRunTest.mockResolvedValue({ passed: true, output: '1 pass' })
        mockIsGateableImplFile.mockReturnValue(false)

        const ctx = {
          tool_input: { file_path: `src/module.${ext}` },
          session_id: 'test-session',
          cwd: '/project',
        }

        const result = await verifyTestsPass(ctx)
        expect(result).toBeNull()

        mockFindTestFile.mockClear()
        mockRunTest.mockClear()
      }
    })

    test('finds test file for colocated test', async () => {
      const implPath = path.resolve('/project/src/module.ts')
      const colocatedTest = path.resolve('/project/src/module.test.ts')

      mockIsTestFile.mockReturnValue(false)
      mockFindTestFile.mockReturnValue(colocatedTest)
      mockRunTest.mockResolvedValue({ passed: true, output: '1 pass' })
      mockIsGateableImplFile.mockReturnValue(false)

      const ctx = {
        tool_input: { file_path: 'src/module.ts' },
        session_id: 'test-session',
        cwd: '/project',
      }

      const result = await verifyTestsPass(ctx)

      expect(result).toBeNull()
      expect(mockRunTest).toHaveBeenCalledWith(colocatedTest, '/project')
    })
  })
})
