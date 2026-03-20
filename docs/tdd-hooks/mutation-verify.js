#!/usr/bin/env node
// PostToolUse — re-run Stryker, diff survivors, block on new untested logic

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

if (process.env.TDD_MUTATION === '0') process.exit(0)

const absPath = path.resolve(filePath)
const snapshotKey = absPath.replace(/[/.]/g, '_')
const SNAPSHOT_FILE = `/tmp/tdd-mutation-${session_id}-${snapshotKey}.json`

// No snapshot means this is a new file — skip (PreToolUse already blocked if needed)
if (!fs.existsSync(SNAPSHOT_FILE)) process.exit(0)

const { survivors: before } = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'))

function runMutation(filePath) {
  const reportPath = `/tmp/stryker-report-after-${session_id}.json`
  const tempConfig = {
    mutate: [filePath],
    testRunner: 'vitest',
    reporters: ['json'],
    jsonReporter: { fileName: reportPath },
    coverageAnalysis: 'perTest',
    timeoutMS: 10000,
    concurrency: 4,
  }

  const configPath = `/tmp/stryker-config-after-${session_id}.json`
  fs.writeFileSync(configPath, JSON.stringify(tempConfig))

  try {
    execSync(`npx stryker run ${configPath}`, {
      stdio: 'pipe',
      timeout: 120_000,
    })
  } catch {}

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
      description: `${m.mutatorName}:${m.replacement}`,
      line: m.location?.start?.line,
    }))
}

const report = runMutation(filePath)
if (!report) process.exit(0)

const after = extractSurvivors(report, filePath)

// Match by description (mutatorName + replacement) — line-number agnostic
// so pure refactors that shift lines don't produce false positives
const beforeDescriptions = new Set(before.map((m) => m.description))
const newSurvivors = after.filter((m) => !beforeDescriptions.has(m.description))
const countDelta = after.length - before.length

if (newSurvivors.length === 0 && countDelta <= 0) process.exit(0) // ✅ clean

const lines = newSurvivors.map((m) => `  Line ${m.line ?? '?'}: [${m.mutator}] → \`${m.replacement}\``)

console.log(
  JSON.stringify({
    decision: 'block',
    reason:
      `🧬 Mutation testing detected new untested logic in \`${filePath}\`.\n\n` +
      `${newSurvivors.length} new surviving mutant(s) appeared after your edit.\n` +
      `This means you introduced code paths that existing tests cannot falsify —\n` +
      `which is new functionality, not a refactor.\n\n` +
      `New survivors:\n${lines.join('\n')}\n\n` +
      `Before: ${before.length} survivors → After: ${after.length} survivors (+${countDelta})\n\n` +
      `Options:\n` +
      `  A) Revert the new logic — keep it a pure refactor\n` +
      `  B) Write a failing test for the new behavior first (Red phase), then re-add the logic`,
  }),
)

process.exit(0)
