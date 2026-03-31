// Run Stryker and snapshot surviving mutants before an impl file is edited (side-effect only)
// Skipped when TDD_MUTATION=0

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { extractSurvivors, buildStrykerConfig } from '../mutation.mjs'
import { getSessionsDir, getFileKey } from '../paths.mjs'
import { isTestFile, isGateableImplFile } from '../test-resolver.mjs'

/**
 * @param {{ tool_input: { file_path: string }, session_id: string, cwd: string }} ctx
 * @returns {null}
 */
export function snapshotMutants(ctx) {
  try {
    if (process.env.TDD_MUTATION === '0') return null

    const { tool_input, session_id, cwd } = ctx
    const filePath = tool_input.file_path
    if (!filePath) return null
    if (isTestFile(filePath)) return null
    if (!isGateableImplFile(filePath, cwd)) return null

    const absPath = path.resolve(filePath)
    if (!fs.existsSync(absPath)) return null

    const sessionsDir = getSessionsDir(cwd)
    const fileKey = getFileKey(absPath)
    const snapshotFile = path.join(sessionsDir, `tdd-mutation-${session_id}-${fileKey}.json`)
    const reportFile = path.join(sessionsDir, `stryker-report-${session_id}-${fileKey}-before.json`)
    const configFile = path.join(sessionsDir, `stryker-config-${session_id}-${fileKey}-before.json`)

    const tempConfig = buildStrykerConfig(absPath, cwd, reportFile)

    fs.mkdirSync(sessionsDir, { recursive: true })
    fs.writeFileSync(configFile, JSON.stringify(tempConfig))

    try {
      execFileSync('node_modules/.bin/stryker', ['run', configFile], {
        cwd,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 180_000,
      })
    } catch {
      // Stryker exits non-zero when mutants survive — expected
    }

    if (!fs.existsSync(reportFile)) return null

    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'))
    const survivors = extractSurvivors(report, absPath)
    fs.writeFileSync(snapshotFile, JSON.stringify({ survivors, filePath: absPath }))
  } catch {
    // Fail open
  }
  return null
}
