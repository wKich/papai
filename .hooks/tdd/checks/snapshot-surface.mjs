// Snapshot API surface + coverage before an impl file is edited (side-effect only)

import fs from 'node:fs'
import path from 'node:path'

import { getCoverage } from '../coverage.mjs'
import { getSessionsDir, getSnapshotKey } from '../paths.mjs'
import { extractSurface } from '../surface-extractor.mjs'
import { findTestFile, isTestFile, isGateableImplFile } from '../test-resolver.mjs'

/**
 * @param {{ tool_input: { file_path: string }, session_id: string, cwd: string }} ctx
 * @returns {null}
 */
export function snapshotSurface(ctx) {
  try {
    const { tool_input, session_id, cwd } = ctx
    const filePath = tool_input.file_path
    if (!filePath) return null
    if (isTestFile(filePath)) return null
    if (!isGateableImplFile(filePath, cwd)) return null

    const absPath = path.resolve(filePath)
    if (!fs.existsSync(absPath)) return null

    const sessionsDir = getSessionsDir(cwd)
    const snapshotFile = path.join(sessionsDir, `tdd-snapshot-${session_id}-${getSnapshotKey(absPath)}.json`)

    const testFile = findTestFile(absPath, cwd)
    const coverage = testFile ? getCoverage(testFile, absPath, cwd) : null

    fs.mkdirSync(sessionsDir, { recursive: true })
    fs.writeFileSync(snapshotFile, JSON.stringify({ surface: extractSurface(absPath), coverage, filePath: absPath }))
  } catch {
    // Fail open
  }
  return null
}
