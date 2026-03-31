import fs from 'node:fs'
import path from 'node:path'

import { getFullCoverage } from './coverage.mjs'
import { getSessionsDir } from './paths.mjs'

const BASELINE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * @typedef {Object} CoverageStats
 * @property {number} covered
 * @property {number} total
 */

/**
 * Return the session-level coverage baseline for all files, creating it on first call.
 *
 * The baseline is built by running the full test suite once per session.
 * Subsequent calls within the same session return the cached snapshot.
 *
 * @param {string} sessionId
 * @param {string} projectRoot
 * @returns {Record<string, CoverageStats> | null}
 */
export function getSessionBaseline(sessionId, projectRoot) {
  const sessionsDir = getSessionsDir(projectRoot)
  const baselineFile = path.join(sessionsDir, `tdd-coverage-baseline-${sessionId}.json`)

  try {
    if (fs.existsSync(baselineFile)) {
      const stat = fs.statSync(baselineFile)
      if (Date.now() - stat.mtimeMs <= BASELINE_TTL_MS) {
        return JSON.parse(fs.readFileSync(baselineFile, 'utf8'))
      }
      fs.unlinkSync(baselineFile)
    }
  } catch {
    // Fall through to creation
  }

  const coverage = getFullCoverage(projectRoot)
  if (coverage) {
    try {
      fs.mkdirSync(sessionsDir, { recursive: true })
      fs.writeFileSync(baselineFile, JSON.stringify(coverage))
    } catch {}
  }
  return coverage
}
