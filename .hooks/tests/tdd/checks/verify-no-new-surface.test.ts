import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { verifyNoNewSurface } from '../../../tdd/checks/verify-no-new-surface.mjs'

// Helper to match the implementation in paths.mjs
function getFileKey(absPath: string): string {
  return createHash('sha256').update(absPath).digest('hex').slice(0, 16)
}

// Mock dependencies
const mockIsTestFile = mock()
const mockIsGateableImplFile = mock()
const mockFindTestFile = mock()
const mockExtractSurface = mock()
const mockGetCoverage = mock()

describe('verifyNoNewSurface', () => {
  let tempDir: string
  let sessionsDir: string
  let originalCwd: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'surface-check-test-'))
    sessionsDir = path.join(tempDir, '.hooks', 'sessions')
    fs.mkdirSync(sessionsDir, { recursive: true })
    originalCwd = process.cwd()

    // Reset all mocks
    mockIsTestFile.mockClear()
    mockIsGateableImplFile.mockClear()
    mockFindTestFile.mockClear()
    mockExtractSurface.mockClear()
    mockGetCoverage.mockClear()

    // Set up default mock behaviors
    mock.module('../../../tdd/test-resolver.mjs', () => ({
      isTestFile: mockIsTestFile,
      isGateableImplFile: mockIsGateableImplFile,
      findTestFile: mockFindTestFile,
    }))

    mock.module('../../../tdd/surface-extractor.mjs', () => ({
      extractSurface: mockExtractSurface,
    }))

    mock.module('../../../tdd/coverage.mjs', () => ({
      getCoverage: mockGetCoverage,
    }))

    mock.module('../../../tdd/paths.mjs', () => ({
      getSessionsDir: () => sessionsDir,
      getFileKey: (absPath: string) => getFileKey(absPath),
    }))
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
    mock.restore()
  })

  test('returns null for test files', () => {
    mockIsTestFile.mockReturnValue(true)

    const result = verifyNoNewSurface({
      tool_input: { file_path: 'src/foo.test.ts' },
      session_id: 'test-session',
      cwd: tempDir,
    })

    expect(result).toBeNull()
    expect(mockIsTestFile).toHaveBeenCalledWith('src/foo.test.ts')
  })

  test('returns null for non-gateable files', () => {
    mockIsTestFile.mockReturnValue(false)
    mockIsGateableImplFile.mockReturnValue(false)

    const result = verifyNoNewSurface({
      tool_input: { file_path: 'docs/readme.md' },
      session_id: 'test-session',
      cwd: tempDir,
    })

    expect(result).toBeNull()
    expect(mockIsGateableImplFile).toHaveBeenCalledWith('docs/readme.md', tempDir)
  })

  test('returns null when no snapshot exists', () => {
    mockIsTestFile.mockReturnValue(false)
    mockIsGateableImplFile.mockReturnValue(true)

    const result = verifyNoNewSurface({
      tool_input: { file_path: 'src/module.ts' },
      session_id: 'test-session',
      cwd: tempDir,
    })

    expect(result).toBeNull()
  })

  test('returns null when no changes detected', () => {
    const implFile = path.join(tempDir, 'src', 'module.ts')
    fs.mkdirSync(path.dirname(implFile), { recursive: true })
    fs.writeFileSync(implFile, 'export function foo() {}')

    const absPath = path.resolve(path.join(tempDir, 'src', 'module.ts'))
    const snapshotPath = path.join(sessionsDir, `tdd-snapshot-test-session-${getFileKey(absPath)}.json`)
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify({
        surface: { exports: ['foo'], signatures: { foo: 0 } },
        coverage: { covered: 10, total: 10 },
      }),
    )

    mockIsTestFile.mockReturnValue(false)
    mockIsGateableImplFile.mockReturnValue(true)
    mockExtractSurface.mockReturnValue({ exports: ['foo'], signatures: { foo: 0 } })
    mockFindTestFile.mockReturnValue(null)

    const result = verifyNoNewSurface({
      tool_input: { file_path: 'src/module.ts' },
      session_id: 'test-session',
      cwd: tempDir,
    })

    expect(result).toBeNull()
  })

  test('blocks when new exports detected', () => {
    const implFile = path.join(tempDir, 'src', 'module.ts')
    fs.mkdirSync(path.dirname(implFile), { recursive: true })
    fs.writeFileSync(implFile, 'export function foo() {}\nexport function bar() {}')

    const absPath = path.resolve(tempDir, 'src', 'module.ts')
    const snapshotPath = path.join(sessionsDir, `tdd-snapshot-test-session-${getFileKey(absPath)}.json`)
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify({
        surface: { exports: ['foo'], signatures: { foo: 0 } },
        coverage: { covered: 10, total: 10 },
      }),
    )

    mockIsTestFile.mockReturnValue(false)
    mockIsGateableImplFile.mockReturnValue(true)
    mockExtractSurface.mockReturnValue({ exports: ['bar', 'foo'], signatures: { foo: 0, bar: 0 } })
    mockFindTestFile.mockReturnValue(null)

    process.chdir(tempDir)
    const result = verifyNoNewSurface({
      tool_input: { file_path: 'src/module.ts' },
      session_id: 'test-session',
      cwd: tempDir,
    })

    expect(result).not.toBeNull()
    expect(result?.decision).toBe('block')
    expect(result?.reason).toContain('New exports')
    expect(result?.reason).toContain('`bar`')
    expect(result?.reason).toContain('src/module.ts')
  })

  test('blocks when new parameters detected', () => {
    const implFile = path.join(tempDir, 'src', 'module.ts')
    fs.mkdirSync(path.dirname(implFile), { recursive: true })
    fs.writeFileSync(implFile, 'export function foo(a, b, c) {}')

    const absPath = path.resolve(tempDir, 'src', 'module.ts')
    const snapshotPath = path.join(sessionsDir, `tdd-snapshot-test-session-${getFileKey(absPath)}.json`)
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify({
        surface: { exports: ['foo'], signatures: { foo: 1 } },
        coverage: { covered: 10, total: 10 },
      }),
    )

    mockIsTestFile.mockReturnValue(false)
    mockIsGateableImplFile.mockReturnValue(true)
    mockExtractSurface.mockReturnValue({ exports: ['foo'], signatures: { foo: 3 } })
    mockFindTestFile.mockReturnValue(null)

    process.chdir(tempDir)
    const result = verifyNoNewSurface({
      tool_input: { file_path: 'src/module.ts' },
      session_id: 'test-session',
      cwd: tempDir,
    })

    expect(result).not.toBeNull()
    expect(result?.decision).toBe('block')
    expect(result?.reason).toContain('new parameter(s)')
    expect(result?.reason).toContain('`foo`')
    expect(result?.reason).toContain('1 → 3')
  })

  test('blocks when coverage regression detected', () => {
    const implFile = path.join(tempDir, 'src', 'module.ts')
    const testFile = path.join(tempDir, 'tests', 'module.test.ts')
    fs.mkdirSync(path.dirname(implFile), { recursive: true })
    fs.mkdirSync(path.dirname(testFile), { recursive: true })
    fs.writeFileSync(implFile, 'export function foo() {}')

    const absPath = path.resolve(tempDir, 'src', 'module.ts')
    const snapshotPath = path.join(sessionsDir, `tdd-snapshot-test-session-${getFileKey(absPath)}.json`)
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify({
        surface: { exports: ['foo'], signatures: { foo: 0 } },
        coverage: { covered: 10, total: 10 },
      }),
    )

    mockIsTestFile.mockReturnValue(false)
    mockIsGateableImplFile.mockReturnValue(true)
    mockExtractSurface.mockReturnValue({ exports: ['foo'], signatures: { foo: 0 } })
    mockFindTestFile.mockReturnValue(testFile)
    mockGetCoverage.mockReturnValue({ covered: 8, total: 10 }) // 2 more uncovered lines

    process.chdir(tempDir)
    const result = verifyNoNewSurface({
      tool_input: { file_path: 'src/module.ts' },
      session_id: 'test-session',
      cwd: tempDir,
    })

    expect(result).not.toBeNull()
    expect(result?.decision).toBe('block')
    expect(result?.reason).toContain('new line(s) without test coverage')
    expect(result?.reason).toContain('2')
  })

  test('blocks when multiple violations detected', () => {
    const implFile = path.join(tempDir, 'src', 'module.ts')
    const testFile = path.join(tempDir, 'tests', 'module.test.ts')
    fs.mkdirSync(path.dirname(implFile), { recursive: true })
    fs.mkdirSync(path.dirname(testFile), { recursive: true })
    fs.writeFileSync(implFile, 'export function foo(a, b) {}\nexport function bar() {}')

    const absPath = path.resolve(tempDir, 'src', 'module.ts')
    const snapshotPath = path.join(sessionsDir, `tdd-snapshot-test-session-${getFileKey(absPath)}.json`)
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify({
        surface: { exports: ['foo'], signatures: { foo: 0 } },
        coverage: { covered: 10, total: 10 },
      }),
    )

    mockIsTestFile.mockReturnValue(false)
    mockIsGateableImplFile.mockReturnValue(true)
    mockExtractSurface.mockReturnValue({
      exports: ['bar', 'foo'],
      signatures: { foo: 2 }, // 2 new params
    })
    mockFindTestFile.mockReturnValue(testFile)
    mockGetCoverage.mockReturnValue({ covered: 8, total: 10 }) // 2 more uncovered

    process.chdir(tempDir)
    const result = verifyNoNewSurface({
      tool_input: { file_path: 'src/module.ts' },
      session_id: 'test-session',
      cwd: tempDir,
    })

    expect(result).not.toBeNull()
    expect(result?.decision).toBe('block')
    expect(result?.reason).toContain('New exports')
    expect(result?.reason).toContain('`bar`')
    expect(result?.reason).toContain('new parameter(s)')
    expect(result?.reason).toContain('new line(s) without test coverage')
    expect(result?.reason).toContain('Next step: Add tests')
  })

  test('includes file path and violation details in reason', () => {
    const implFile = path.join(tempDir, 'src', 'providers', 'kaneo', 'client.ts')
    fs.mkdirSync(path.dirname(implFile), { recursive: true })
    fs.writeFileSync(implFile, 'export function fetchData() {}\nexport function updateCache() {}')

    const absPath = path.resolve(tempDir, 'src', 'providers', 'kaneo', 'client.ts')
    const snapshotPath = path.join(sessionsDir, `tdd-snapshot-test-session-${getFileKey(absPath)}.json`)
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify({
        surface: { exports: ['fetchData'], signatures: { fetchData: 0 } },
        coverage: { covered: 10, total: 10 },
      }),
    )

    mockIsTestFile.mockReturnValue(false)
    mockIsGateableImplFile.mockReturnValue(true)
    mockExtractSurface.mockReturnValue({
      exports: ['fetchData', 'updateCache'],
      signatures: { fetchData: 0 },
    })
    mockFindTestFile.mockReturnValue(null)

    process.chdir(tempDir)
    const result = verifyNoNewSurface({
      tool_input: { file_path: 'src/providers/kaneo/client.ts' },
      session_id: 'test-session',
      cwd: tempDir,
    })

    expect(result).not.toBeNull()
    expect(result?.reason).toContain('src/providers/kaneo/client.ts')
    expect(result?.reason).toContain('New exports')
    expect(result?.reason).toContain('`updateCache`')
  })

  test('handles missing snapshot gracefully', () => {
    mockIsTestFile.mockReturnValue(false)
    mockIsGateableImplFile.mockReturnValue(true)

    const result = verifyNoNewSurface({
      tool_input: { file_path: 'src/new-module.ts' },
      session_id: 'test-session',
      cwd: tempDir,
    })

    expect(result).toBeNull()
  })

  test('handles errors gracefully (fail open)', () => {
    mockIsTestFile.mockImplementation(() => {
      throw new Error('Unexpected error')
    })

    const result = verifyNoNewSurface({
      tool_input: { file_path: 'src/module.ts' },
      session_id: 'test-session',
      cwd: tempDir,
    })

    expect(result).toBeNull()
  })

  test('handles missing file_path in tool_input', () => {
    const result = verifyNoNewSurface({
      tool_input: {} as { file_path: string },
      session_id: 'test-session',
      cwd: tempDir,
    })

    expect(result).toBeNull()
  })

  test('returns null when coverage cannot be determined', () => {
    const implFile = path.join(tempDir, 'src', 'module.ts')
    const testFile = path.join(tempDir, 'tests', 'module.test.ts')
    fs.mkdirSync(path.dirname(implFile), { recursive: true })
    fs.mkdirSync(path.dirname(testFile), { recursive: true })
    fs.writeFileSync(implFile, 'export function foo() {}')

    const absPath = path.resolve(tempDir, 'src', 'module.ts')
    const snapshotPath = path.join(sessionsDir, `tdd-snapshot-test-session-${getFileKey(absPath)}.json`)
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify({
        surface: { exports: ['foo'], signatures: { foo: 0 } },
        coverage: { covered: 10, total: 10 },
      }),
    )

    mockIsTestFile.mockReturnValue(false)
    mockIsGateableImplFile.mockReturnValue(true)
    mockExtractSurface.mockReturnValue({ exports: ['foo'], signatures: { foo: 0 } })
    mockFindTestFile.mockReturnValue(null)

    process.chdir(tempDir)
    const result = verifyNoNewSurface({
      tool_input: { file_path: 'src/module.ts' },
      session_id: 'test-session',
      cwd: tempDir,
    })

    expect(result).toBeNull()
  })

  test('does not block when coverage improves', () => {
    const implFile = path.join(tempDir, 'src', 'module.ts')
    const testFile = path.join(tempDir, 'tests', 'module.test.ts')
    fs.mkdirSync(path.dirname(implFile), { recursive: true })
    fs.mkdirSync(path.dirname(testFile), { recursive: true })
    fs.writeFileSync(implFile, 'export function foo() {}')

    const absPath = path.resolve(tempDir, 'src', 'module.ts')
    const snapshotPath = path.join(sessionsDir, `tdd-snapshot-test-session-${getFileKey(absPath)}.json`)
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify({
        surface: { exports: ['foo'], signatures: { foo: 0 } },
        coverage: { covered: 8, total: 10 },
      }),
    )

    mockIsTestFile.mockReturnValue(false)
    mockIsGateableImplFile.mockReturnValue(true)
    mockExtractSurface.mockReturnValue({ exports: ['foo'], signatures: { foo: 0 } })
    mockFindTestFile.mockReturnValue(testFile)
    mockGetCoverage.mockReturnValue({ covered: 10, total: 10 }) // Coverage improved

    process.chdir(tempDir)
    const result = verifyNoNewSurface({
      tool_input: { file_path: 'src/module.ts' },
      session_id: 'test-session',
      cwd: tempDir,
    })

    expect(result).toBeNull()
  })

  test('does not block when coverage stays the same', () => {
    const implFile = path.join(tempDir, 'src', 'module.ts')
    const testFile = path.join(tempDir, 'tests', 'module.test.ts')
    fs.mkdirSync(path.dirname(implFile), { recursive: true })
    fs.mkdirSync(path.dirname(testFile), { recursive: true })
    fs.writeFileSync(implFile, 'export function foo() {}')

    const absPath = path.resolve(tempDir, 'src', 'module.ts')
    const snapshotPath = path.join(sessionsDir, `tdd-snapshot-test-session-${getFileKey(absPath)}.json`)
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify({
        surface: { exports: ['foo'], signatures: { foo: 0 } },
        coverage: { covered: 10, total: 10 },
      }),
    )

    mockIsTestFile.mockReturnValue(false)
    mockIsGateableImplFile.mockReturnValue(true)
    mockExtractSurface.mockReturnValue({ exports: ['foo'], signatures: { foo: 0 } })
    mockFindTestFile.mockReturnValue(testFile)
    mockGetCoverage.mockReturnValue({ covered: 10, total: 10 }) // Coverage same

    process.chdir(tempDir)
    const result = verifyNoNewSurface({
      tool_input: { file_path: 'src/module.ts' },
      session_id: 'test-session',
      cwd: tempDir,
    })

    expect(result).toBeNull()
  })
})
