// Re-run Stryker, diff surviving mutants against pre-edit snapshot, block on new survivors
// Skipped when TDD_MUTATION=0

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { extractSurvivors, buildStrykerConfig } from '../mutation.mjs'
import { getSessionsDir, getSnapshotKey } from '../paths.mjs'
import { isTestFile, isGateableImplFile } from '../test-resolver.mjs'

/**
 * @param {{ tool_input: { file_path: string }, session_id: string, cwd: string }} ctx
 * @returns {{ decision: 'block', reason: string } | null}
 */
export function verifyNoNewMutants(ctx) {
  try {
    if (process.env.TDD_MUTATION === '0') return null

    const { tool_input, session_id, cwd } = ctx
    const filePath = tool_input.file_path
    if (!filePath) return null
    if (isTestFile(filePath)) return null
    if (!isGateableImplFile(filePath, cwd)) return null

    const absPath = path.resolve(filePath)
    const sessionsDir = getSessionsDir(cwd)
    const snapshotFile = path.join(sessionsDir, `tdd-mutation-${session_id}-${getSnapshotKey(absPath)}.json`)

    if (!fs.existsSync(snapshotFile)) return null

    const { survivors: before } = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'))

    const reportFile = path.join(sessionsDir, `stryker-report-${session_id}-after.json`)
    const configFile = path.join(sessionsDir, `stryker-config-${session_id}-after.json`)

    const tempConfig = buildStrykerConfig(absPath, cwd, reportFile)

    fs.mkdirSync(sessionsDir, { recursive: true })
    fs.writeFileSync(configFile, JSON.stringify(tempConfig))

    try {
      execSync(`node_modules/.bin/stryker run ${configFile}`, {
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
    const after = extractSurvivors(report, absPath)

    const beforeDescriptions = new Set(before.map((m) => m.description))
    const newSurvivors = after.filter((m) => !beforeDescriptions.has(m.description))

    if (newSurvivors.length === 0) return null

    const relPath = path.relative(cwd, filePath)
    const lines = newSurvivors.map((m) => `  Line ${m.line ?? '?'}: [${m.mutator}] → \`${m.replacement}\``)

    return {
      decision: 'block',
      reason:
        `${newSurvivors.length} new untested code paths found in \`${relPath}\`:\n${lines.join('\n')}\n\n` +
        `These code paths were not caught by any test. ` +
        `Next step: Write tests that exercise these code paths.`,
    }
  } catch {
    // Fail open
  }
  return null
}
