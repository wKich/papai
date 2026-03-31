// Session-level mutation testing for Claude hooks
// Run once at session start (baseline) and end (verification)

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { getSessionsDir } from './paths.mjs'

/**
 * @typedef {Object} Survivor
 * @property {string} mutator
 * @property {string} replacement
 * @property {number | undefined} line
 * @property {string} description
 */

/**
 * Collect all TypeScript files in src/ directory recursively
 * @param {string} dir - Directory to search
 * @returns {string[]}
 */
function collectTsFiles(dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(fullPath)
    }
  }
  return files
}

/**
 * Read and extend project's stryker config for session-level mutation testing
 * @param {string} cwd - Project root
 * @param {string} reportFile - Path for JSON report output
 * @param {string[]} mutateFiles - Files to mutate
 * @returns {Record<string, unknown>}
 */
function buildSessionStrykerConfig(cwd, reportFile, mutateFiles) {
  const projectConfigPath = path.join(cwd, 'stryker.config.json')
  let baseConfig = {}

  try {
    if (fs.existsSync(projectConfigPath)) {
      baseConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'))
    }
  } catch {
    // Fall back to minimal defaults
  }

  return {
    ...baseConfig,
    mutate: mutateFiles,
    incremental: false,
    reporters: ['json'],
    jsonReporter: { fileName: reportFile },
  }
}

/**
 * Extract surviving mutants from a Stryker JSON report
 * @param {unknown} report - Stryker JSON report
 * @returns {Record<string, Survivor[]>}
 */
function extractSurvivorsFromReport(report) {
  const survivors = {}

  for (const [filePath, fileData] of Object.entries(report.files ?? {})) {
    const fileSurvivors = Object.values(fileData.mutants ?? {})
      .filter((m) => m.status === 'Survived')
      .map((m) => ({
        mutator: m.mutatorName,
        replacement: m.replacement,
        line: m.location?.start?.line,
        description: `${m.mutatorName}:${m.replacement}`,
      }))
    if (fileSurvivors.length > 0) {
      survivors[path.resolve(filePath)] = fileSurvivors
    }
  }

  return survivors
}

/**
 * Capture mutation baseline at session start
 * @param {{ session_id: string, cwd: string }} ctx
 * @returns {null}
 */
export function captureSessionMutationBaseline(ctx) {
  try {
    if (process.env.TDD_MUTATION === '0') return null

    const { session_id, cwd } = ctx
    const srcDir = path.join(cwd, 'src')
    if (!fs.existsSync(srcDir)) return null

    const allFiles = collectTsFiles(srcDir)
    if (allFiles.length === 0) return null

    const sessionsDir = getSessionsDir(cwd)
    const reportFile = path.join(sessionsDir, `stryker-session-${session_id}-baseline.json`)
    const configFile = path.join(sessionsDir, `stryker-config-${session_id}-baseline.json`)
    const baselineFile = path.join(sessionsDir, `tdd-session-mutation-baseline-${session_id}.json`)

    const tempConfig = buildSessionStrykerConfig(cwd, reportFile, allFiles)

    fs.mkdirSync(sessionsDir, { recursive: true })
    fs.writeFileSync(configFile, JSON.stringify(tempConfig))

    try {
      execFileSync('node_modules/.bin/stryker', ['run', configFile], {
        cwd,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 600_000, // 10 minutes for full src run
      })
    } catch {
      // Stryker exits non-zero when mutants survive — expected
    }

    if (fs.existsSync(reportFile)) {
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'))
      const allSurvivors = extractSurvivorsFromReport(report)
      fs.writeFileSync(baselineFile, JSON.stringify(allSurvivors))
    }
  } catch {
    // Fail open - mutation testing is optional
  }
  return null
}

/**
 * Verify no new mutants at session end
 * @param {{ session_id: string, cwd: string }} ctx
 * @returns {null}
 */
export function verifySessionMutationBaseline(ctx) {
  const lines = []
  try {
    if (process.env.TDD_MUTATION === '0') return null

    const { session_id, cwd } = ctx
    const srcDir = path.join(cwd, 'src')
    if (!fs.existsSync(srcDir)) return null

    const allFiles = collectTsFiles(srcDir)
    if (allFiles.length === 0) return null

    const sessionsDir = getSessionsDir(cwd)
    const baselineFile = path.join(sessionsDir, `tdd-session-mutation-baseline-${session_id}.json`)

    if (!fs.existsSync(baselineFile)) return null

    const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'))

    const reportFile = path.join(sessionsDir, `stryker-session-${session_id}-final.json`)
    const configFile = path.join(sessionsDir, `stryker-config-${session_id}-final.json`)

    const tempConfig = buildSessionStrykerConfig(cwd, reportFile, allFiles)

    fs.mkdirSync(sessionsDir, { recursive: true })
    fs.writeFileSync(configFile, JSON.stringify(tempConfig))

    try {
      execFileSync('node_modules/.bin/stryker', ['run', configFile], {
        cwd,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 600_000,
      })
    } catch {
      // Stryker exits non-zero when mutants survive — expected
    }

    if (!fs.existsSync(reportFile)) return null

    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'))
    const finalSurvivors = extractSurvivorsFromReport(report)

    // Compare final against baseline to find NEW survivors
    const newSurvivorsByFile = {}
    let totalNewSurvivors = 0

    for (const [filePath, finalList] of Object.entries(finalSurvivors)) {
      const baselineList = baseline[filePath] ?? []
      const baselineDescriptions = new Set(baselineList.map((m) => m.description))

      const newInFile = finalList.filter((m) => !baselineDescriptions.has(m.description))
      if (newInFile.length > 0) {
        newSurvivorsByFile[filePath] = newInFile
        totalNewSurvivors += newInFile.length
      }
    }

    if (totalNewSurvivors === 0) return null

    // Build and output report
    lines = [`Mutation testing detected ${totalNewSurvivors} new untested code path(s):`, '']

    for (const [filePath, survivors] of Object.entries(newSurvivorsByFile)) {
      const relPath = path.relative(cwd, filePath)
      lines.push(`\`${relPath}\`:`)
      for (const s of survivors) {
        lines.push(`  Line ${s.line ?? '?'}: [${s.mutator}] → \`${s.replacement}\``)
      }
      lines.push('')
    }

    lines.push('These code paths were not caught by any test.')
    lines.push('Next step: Write tests that exercise these code paths.')

    // Output to stderr so Claude can see it
    console.error('\n=== MUTATION TESTING REPORT ===\n')
    console.error(lines.join('\n'))
    console.error('\n================================\n')
  } catch {
    // Fail open
  }
  if (lines.length > 0) {
    // Block session stop - throw error with report details
    throw new Error(lines.join('\n'))
  }

  return null
}
