// Shared Stryker mutation testing utilities

import path from 'node:path'

/**
 * @typedef {Object} Survivor
 * @property {string} mutator
 * @property {string} replacement
 * @property {number | undefined} line
 * @property {string} description
 */

/**
 * Extract surviving mutants from a Stryker JSON report for a specific file.
 * @param {unknown} report - Stryker JSON report
 * @param {string} targetAbsPath - Absolute path to the impl file
 * @returns {Survivor[]}
 */
export function extractSurvivors(report, targetAbsPath) {
  const entry = Object.entries(report.files ?? {}).find(([f]) => path.resolve(f) === targetAbsPath)
  if (!entry) return []
  return Object.values(entry[1].mutants ?? {})
    .filter((m) => m.status === 'Survived')
    .map((m) => ({
      mutator: m.mutatorName,
      replacement: m.replacement,
      line: m.location?.start?.line,
      // Stable identity: mutator name + replacement text — line-number agnostic
      // so pure refactors that shift line numbers don't produce false positives
      description: `${m.mutatorName}:${m.replacement}`,
    }))
}

/**
 * Build a Stryker config object for a single file.
 * @param {string} absPath - Absolute path to the file to mutate
 * @param {string} cwd - Project root
 * @param {string} reportFile - Path to write the JSON report
 * @returns {Record<string, unknown>}
 */
export function buildStrykerConfig(absPath, cwd, reportFile) {
  return {
    testRunner: 'bun',
    appendPlugins: ['@hughescr/stryker-bun-runner'],
    checkers: ['typescript'],
    tsconfigFile: path.join(cwd, 'tsconfig.json'),
    bun: { timeout: 120000 },
    mutate: [absPath],
    coverageAnalysis: 'perTest',
    ignoreStatic: true,
    incremental: false,
    concurrency: 2,
    timeoutMS: 60000,
    timeoutFactor: 2,
    reporters: ['json'],
    jsonReporter: { fileName: reportFile },
    cleanTempDir: true,
    ignorePatterns: ['node_modules', '.stryker-tmp'],
  }
}
