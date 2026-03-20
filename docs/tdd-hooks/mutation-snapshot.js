#!/usr/bin/env node
// PreToolUse — run Stryker and snapshot surviving mutants before refactor

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
const { tool_name, tool_input, session_id } = input

const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit']
const TEST_PATTERN = /(\.(test|spec)\.(ts|js|tsx|jsx|py)|_test\.go|_test\.rs)$/
const IMPL_PATTERN = /\.(ts|js|tsx|jsx|py|go|rs)$/

if (!WRITE_TOOLS.includes(tool_name)) process.exit(0)

const filePath = tool_input.file_path ?? tool_input.path
if (!filePath || TEST_PATTERN.test(filePath) || !IMPL_PATTERN.test(filePath)) process.exit(0)

// Skip mutation on new files — no baseline to compare against
if (!fs.existsSync(filePath)) process.exit(0)

// Fast mode: skip mutation during iterative edits, enforce only on final write
// Set TDD_MUTATION=0 to disable, TDD_MUTATION=1 (default) to enable
if (process.env.TDD_MUTATION === '0') process.exit(0)

const absPath = path.resolve(filePath)
const snapshotKey = absPath.replace(/[/.]/g, '_')
const SNAPSHOT_FILE = `/tmp/tdd-mutation-${session_id}-${snapshotKey}.json`

function runMutation(filePath) {
  const reportPath = `/tmp/stryker-report-${session_id}.json`
  const tempConfig = {
    mutate: [filePath],
    testRunner: 'vitest',
    reporters: ['json'],
    jsonReporter: { fileName: reportPath },
    coverageAnalysis: 'perTest',
    timeoutMS: 10000,
    concurrency: 4,
  }

  const configPath = `/tmp/stryker-config-${session_id}.json`
  fs.writeFileSync(configPath, JSON.stringify(tempConfig))

  try {
    execSync(`npx stryker run ${configPath}`, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 120_000,
    })
  } catch {
    // Stryker exits non-zero when mutants survive — expected
  }

  if (!fs.existsSync(reportPath)) return null
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'))
}

function extractSurvivors(report, targetFile) {
  const absTarget = path.resolve(targetFile)
  const fileReport = Object.entries(report.files ?? {}).find(([f]) => path.resolve(f) === absTarget)
  if (!fileReport) return []

  return Object.values(fileReport[1].mutants ?? {})
    .filter((m) => m.status === 'Survived')
    .map((m) => ({
      mutator: m.mutatorName,
      replacement: m.replacement,
      col: m.location?.start?.column,
      // Stable identity: mutator name + replacement text (line-number agnostic)
      description: `${m.mutatorName}:${m.replacement}`,
    }))
}

const report = runMutation(filePath)
if (!report) process.exit(0) // Stryker unavailable — skip gracefully

const survivors = extractSurvivors(report, filePath)
fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ survivors, filePath: absPath }))

process.exit(0)
