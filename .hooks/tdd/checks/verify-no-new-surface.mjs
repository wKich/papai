// Diff API surface + coverage against pre-edit snapshot; block if new functionality detected

import fs from 'node:fs'
import path from 'node:path'

import { getCoverage } from '../coverage.mjs'
import { getSessionsDir, getFileKey } from '../paths.mjs'
import { extractSurface } from '../surface-extractor.mjs'
import { findTestFile, isTestFile, isGateableImplFile } from '../test-resolver.mjs'

/**
 * @typedef {Object} Surface
 * @property {string[]} exports
 * @property {Record<string, number>} signatures
 */

/**
 * @typedef {Object} CoverageStats
 * @property {number} covered
 * @property {number} total
 */

/**
 * @typedef {Object} SurfaceSnapshot
 * @property {Surface} surface
 * @property {CoverageStats | null} coverage
 * @property {string} filePath
 */

/**
 * @typedef {Object} BlockResult
 * @property {'block'} decision
 * @property {string} reason
 */

/**
 * @param {{ tool_input: { file_path: string }, session_id: string, cwd: string }} ctx
 * @returns {BlockResult | null}
 */
export function verifyNoNewSurface(ctx) {
  try {
    const { tool_input, session_id, cwd } = ctx
    const filePath = tool_input.file_path
    if (!filePath) return null
    if (isTestFile(filePath)) return null
    if (!isGateableImplFile(filePath, cwd)) return null

    const absPath = path.resolve(filePath)
    const snapshotFile = path.join(getSessionsDir(cwd), `tdd-snapshot-${session_id}-${getFileKey(absPath)}.json`)

    if (!fs.existsSync(snapshotFile)) return null

    const { surface: before, coverage: beforeCov } = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'))
    const after = extractSurface(absPath)
    const violations = []

    // Check 1: New exports
    const newExports = after.exports.filter((e) => !before.exports.includes(e))
    if (newExports.length > 0) {
      violations.push(
        `New exports: ${newExports.map((e) => `\`${e}\``).join(', ')}`,
      )
    }

    // Check 2: New parameters on existing functions
    for (const [fn, newCount] of Object.entries(after.signatures)) {
      const oldCount = before.signatures[fn]
      if (oldCount !== undefined && newCount > oldCount) {
        violations.push(
          `Function \`${fn}\` has ${newCount - oldCount} new parameter(s) (${oldCount} → ${newCount})`,
        )
      }
    }

    // Check 3: Coverage regression (more uncovered lines than before this edit)
    const testFile = findTestFile(absPath, cwd)
    if (testFile && beforeCov) {
      const afterCov = getCoverage(testFile, absPath, cwd)
      if (afterCov) {
        const uncoveredBefore = beforeCov.total - beforeCov.covered
        const uncoveredAfter = afterCov.total - afterCov.covered
        if (uncoveredAfter > uncoveredBefore) {
          violations.push(
            `${uncoveredAfter - uncoveredBefore} new line(s) without test coverage`,
          )
        }
      }
    }

    if (violations.length > 0) {
      const relPath = path.relative(cwd, filePath)
      return {
        decision: 'block',
        reason:
          `You added new functionality to \`${relPath}\` that has no tests.\n\n` +
          violations.map((v, i) => `${i + 1}. ${v}`).join('\n\n') +
          `\n\nNext step: Add tests for this new functionality.`,
      }
    }
  } catch {
    // Fail open
  }
  return null
}
