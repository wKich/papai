// .opencode/plugins/tdd-enforcement.ts
// OpenCode plugin — TDD enforcement following PIPELINES.md specification
// Implements all 7 checks with sequential short-circuit logic

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from '@opencode-ai/plugin'

import { getSessionBaseline } from '../../.hooks/tdd/coverage-session.mjs'
import { getCoverage } from '../../.hooks/tdd/coverage.mjs'
import { extractSurvivors, buildStrykerConfig } from '../../.hooks/tdd/mutation.mjs'
import { getSessionsDir } from '../../.hooks/tdd/paths.mjs'
import { SessionState } from '../../.hooks/tdd/session-state.mjs'
import { extractSurface } from '../../.hooks/tdd/surface-extractor.mjs'
import { findTestFile, isTestFile, isGateableImplFile, suggestTestPath } from '../../.hooks/tdd/test-resolver.mjs'
import { runTest } from '../../.hooks/tdd/test-runner.mjs'

// OpenCode edit tools that use filePath
const EDIT_TOOLS = new Set(['write', 'edit', 'multiedit'])

/**
 * Generate a file key from absolute path for snapshot storage.
 * Uses SHA-256 hash truncated to 16 characters for uniqueness.
 * Format: tdd-{type}-${session_id}-${hash} (per PIPELINES.md)
 * Note: For SessionState, session_id is handled by the session isolation.
 */
function getFileKey(absPath: string): string {
  return createHash('sha256').update(absPath).digest('hex').slice(0, 16)
}

/**
 * Check [2] snapshotSurface + Check [3] snapshotMutants
 * Run before file write - captures pre-edit state
 */
async function runPreWriteChecks(
  state: SessionState,
  filePath: string,
  absPath: string,
  directory: string,
): Promise<void> {
  // Only for gateable impl files
  if (!isGateableImplFile(filePath, directory)) return

  const fileKey = getFileKey(absPath)

  // [2] Snapshot surface + coverage (if file exists)
  if (fs.existsSync(absPath)) {
    const testFile = findTestFile(absPath, directory)
    const surface = extractSurface(absPath)
    const coverage = testFile ? getCoverage(testFile, absPath, directory) : null

    state.setSurfaceSnapshot(fileKey, {
      surface,
      coverage,
      filePath: absPath,
    })
  }

  // [3] Snapshot mutants (skipped if TDD_MUTATION=0)
  if (process.env['TDD_MUTATION'] !== '0' && fs.existsSync(absPath)) {
    const sessionsDir = path.join(directory, '.hooks', 'sessions')
    const reportFile = path.join(sessionsDir, `stryker-report-${fileKey}-before.json`)
    const configFile = path.join(sessionsDir, `stryker-config-${fileKey}-before.json`)

    const tempConfig = buildStrykerConfig(absPath, directory, reportFile)

    try {
      fs.mkdirSync(sessionsDir, { recursive: true })
      fs.writeFileSync(configFile, JSON.stringify(tempConfig))

      try {
        execFileSync('node_modules/.bin/stryker', ['run', configFile], {
          cwd: directory,
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 180_000,
        })
      } catch {
        // Stryker exits non-zero when mutants survive — expected
      }

      if (fs.existsSync(reportFile)) {
        const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'))
        const survivors = extractSurvivors(report, absPath)
        state.setMutationSnapshot(fileKey, { survivors, filePath: absPath })
      }
    } catch {
      // Fail open - mutation testing is optional
    }
  }
}

/**
 * Check [5] verifyTestsPass - Run tests and check coverage baseline
 */
async function verifyTestsPass(
  sessionId: string,
  filePath: string,
  absPath: string,
  directory: string,
): Promise<{ decision: 'block'; reason: string } | null> {
  const testFile = isTestFile(filePath) ? absPath : findTestFile(absPath, directory)
  if (!testFile) return null

  const result = await runTest(testFile, directory)

  if (!result.passed) {
    const relPath = path.relative(directory, filePath)
    const isTest = isTestFile(filePath)
    const reason = [
      `Tests failed after ${isTest ? 'writing' : 'editing'} \`${relPath}\`.`,
      '',
      '── Test output ──────────────────────────────',
      result.output,
      '─────────────────────────────────────────────',
      '',
      isTest
        ? 'Next step: Write the implementation to make this test pass.'
        : 'Next step: Fix the code to make all tests pass.',
    ].join('\n')
    return { decision: 'block', reason }
  }

  // Coverage enforcement - only for impl files in src/
  if (!isTestFile(filePath) && isGateableImplFile(filePath, directory)) {
    // Get session baseline (captured at session start by PreToolUse hook)
    const baseline = getSessionBaseline(sessionId, directory)

    const baselineCov = baseline?.[absPath]
    if (baselineCov && baselineCov.total > 0) {
      const cov = getCoverage(testFile, absPath, directory)
      if (cov && cov.total > 0) {
        const baselinePct = baselineCov.covered / baselineCov.total
        const currentPct = cov.covered / cov.total
        if (currentPct < baselinePct) {
          const relPath = path.relative(directory, filePath)
          const drop = ((baselinePct - currentPct) * 100).toFixed(1)
          const reason = [
            `Code coverage dropped in \`${relPath}\`.`,
            '',
            `Before: ${(baselinePct * 100).toFixed(1)}% (${baselineCov.covered}/${baselineCov.total} lines)`,
            `After:  ${(currentPct * 100).toFixed(1)}% (${cov.covered}/${cov.total} lines), −${drop}pp`,
            '',
            'Next step: Write tests to cover the new code paths.',
          ].join('\n')
          return { decision: 'block', reason }
        }
      }
    }
  }

  return null
}

/**
 * Check [6] verifyNoNewSurface - Diff API surface against snapshot
 */
function verifyNoNewSurface(
  state: SessionState,
  filePath: string,
  absPath: string,
  directory: string,
): { decision: 'block'; reason: string } | null {
  if (!isGateableImplFile(filePath, directory)) return null

  const fileKey = getFileKey(absPath)
  const snapshot = state.getSurfaceSnapshot(fileKey)
  if (!snapshot) return null

  const { surface: before, coverage: beforeCov } = snapshot
  const after = extractSurface(absPath)
  const violations: string[] = []

  // Check 1: New exports
  const newExports = after.exports.filter((e): e is string => typeof e === 'string' && !before.exports.includes(e))
  if (newExports.length > 0) {
    const exportsList = newExports.map((e) => `\`${e}\``).join(', ')
    violations.push(`New exports: ${exportsList}`)
  }

  // Check 2: New parameters on existing functions
  for (const [fn, newCount] of Object.entries(after.signatures)) {
    const oldCount = before.signatures[fn]
    if (oldCount !== undefined && newCount > oldCount) {
      violations.push(`Function \`${fn}\` has ${newCount - oldCount} new parameter(s) (${oldCount} → ${newCount})`)
    }
  }

  // Check 3: Coverage regression (more uncovered lines than before this edit)
  const testFile = findTestFile(absPath, directory)
  if (testFile && beforeCov) {
    const afterCov = getCoverage(testFile, absPath, directory)
    if (afterCov) {
      const uncoveredBefore = beforeCov.total - beforeCov.covered
      const uncoveredAfter = afterCov.total - afterCov.covered
      if (uncoveredAfter > uncoveredBefore) {
        violations.push(`${uncoveredAfter - uncoveredBefore} new line(s) without test coverage`)
      }
    }
  }

  if (violations.length > 0) {
    const relPath = path.relative(directory, filePath)
    const reason = [
      `You added new functionality to \`${relPath}\` that has no tests.`,
      '',
      ...violations.map((v, i) => `${i + 1}. ${v}`),
      '',
      'Next step: Add tests for this new functionality.',
    ].join('\n')
    return { decision: 'block', reason }
  }

  return null
}

/**
 * Check [7] verifyNoNewMutants - Diff mutants against snapshot
 */
function verifyNoNewMutants(
  state: SessionState,
  filePath: string,
  absPath: string,
  directory: string,
): { decision: 'block'; reason: string } | null {
  if (process.env['TDD_MUTATION'] === '0') return null
  if (!isGateableImplFile(filePath, directory)) return null

  const fileKey = getFileKey(absPath)
  const snapshot = state.getMutationSnapshot(fileKey)
  if (!snapshot) return null

  const { survivors: before } = snapshot
  const sessionsDir = path.join(directory, '.hooks', 'sessions')
  const reportFile = path.join(sessionsDir, `stryker-report-${fileKey}-after.json`)
  const configFile = path.join(sessionsDir, `stryker-config-${fileKey}-after.json`)

  const tempConfig = buildStrykerConfig(absPath, directory, reportFile)

  try {
    fs.mkdirSync(sessionsDir, { recursive: true })
    fs.writeFileSync(configFile, JSON.stringify(tempConfig))

    try {
      execFileSync('node_modules/.bin/stryker', ['run', configFile], {
        cwd: directory,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 180_000,
      })
    } catch {
      // Stryker exits non-zero when mutants survive — expected
    }

    if (!fs.existsSync(reportFile)) return null

    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'))
    const after = extractSurvivors(report, absPath)

    const beforeDescriptions = new Set(before.map((m: { description: string }) => m.description))
    const newSurvivors = after.filter((m: { description: string }) => !beforeDescriptions.has(m.description))

    if (newSurvivors.length === 0) return null

    const relPath = path.relative(directory, filePath)
    const lines = newSurvivors.map(
      (m: { line?: number; mutator: string; replacement: string }) =>
        `  Line ${m.line ?? '?'}: [${m.mutator}] → \`${m.replacement}\``,
    )

    const reason = [
      `${newSurvivors.length} new untested code paths found in \`${relPath}\`:`,
      ...lines,
      '',
      'These code paths were not caught by any test.',
      'Next step: Write tests that exercise these code paths.',
    ].join('\n')

    return { decision: 'block', reason }
  } catch {
    // Fail open
  }

  return null
}

export const TddEnforcement: Plugin = async ({ directory }) => {
  const sessionsDir = getSessionsDir(directory)

  return {
    // PRE-WRITE HOOK (runs before Write/Edit/MultiEdit)
    'tool.execute.before': async (input) => {
      const state = new SessionState(input.sessionID, sessionsDir)

      // Only process edit tools
      if (!EDIT_TOOLS.has(input.tool)) return

      const filePath = (input as unknown as { args: { filePath: string } }).args.filePath
      if (!filePath) return

      // Skip test files and non-gateable files for TDD gate
      if (isTestFile(filePath)) return
      if (!isGateableImplFile(filePath, directory)) return

      const absPath = path.resolve(directory, filePath)

      // [1] enforceTdd - Block impl writes without test
      if (findTestFile(absPath, directory)) {
        // Test exists - proceed to snapshots
      } else {
        // Check session state for tests written this session
        const writtenTests = state.getWrittenTests()
        const alreadyTestedThisSession = writtenTests.some((testAbsPath: string) => {
          const testRel = path.relative(directory, testAbsPath)
          if (testRel.startsWith('tests/') || testRel.startsWith('tests\\')) {
            const withoutTests = testRel.replace(/^tests[/\\]/, '')
            const ext = path.extname(withoutTests)
            const base = withoutTests.slice(0, -ext.length).replace(/\.(test|spec)$/, '')
            if (path.join(directory, 'src', `${base}${ext}`) === absPath) return true
          }
          return false
        })

        if (!alreadyTestedThisSession) {
          const relPath = path.relative(directory, filePath)
          const suggestedTest = suggestTestPath(relPath)
          const reason = [
            `Cannot write \`${relPath}\` because no test file exists.`,
            '',
            'Step 1: Write a failing test:',
            `  → ${suggestedTest}`,
            '',
            'Step 2: Write the implementation to make the test pass.',
          ].join('\n')
          throw new Error(reason)
        }
      }

      // [2] snapshotSurface + [3] snapshotMutants
      try {
        await runPreWriteChecks(state, filePath, absPath, directory)
      } catch {
        // Fail open - don't block on snapshot errors
      }
    },

    // POST-WRITE HOOK (runs after Write/Edit/MultiEdit)
    'tool.execute.after': async (input) => {
      if (!EDIT_TOOLS.has(input.tool)) return

      const filePath = input.args.filePath as string
      if (!filePath) return

      const state = new SessionState(input.sessionID, sessionsDir)
      const absPath = path.resolve(directory, filePath)

      // [4] trackTestWrite - Record test files written this session
      if (isTestFile(filePath)) {
        state.addWrittenTest(absPath)
      }

      // Only run verification for TS/JS files
      const IMPL_PATTERN = /\.(?:ts|js|tsx|jsx)$/
      if (!IMPL_PATTERN.test(filePath)) return

      const testFile = isTestFile(filePath) ? absPath : findTestFile(absPath, directory)
      if (!testFile) return

      // [5] verifyTestsPass - Run tests and check coverage
      const testResult = await verifyTestsPass(input.sessionID, filePath, absPath, directory)

      if (testResult) {
        throw new Error(testResult.reason)
      }

      // [6] verifyNoNewSurface + [7] verifyNoNewMutants
      // Only run these for gateable impl files (not test files)
      if (isGateableImplFile(filePath, directory)) {
        const surfaceResult = verifyNoNewSurface(state, filePath, absPath, directory)
        const mutantResult = verifyNoNewMutants(state, filePath, absPath, directory)

        if (surfaceResult && mutantResult) {
          const combinedReason = [surfaceResult.reason, '', '---', '', mutantResult.reason].join('\n')
          throw new Error(combinedReason)
        } else if (surfaceResult || mutantResult) {
          throw new Error((surfaceResult || mutantResult)!.reason)
        }
      }
    },
  }
}
