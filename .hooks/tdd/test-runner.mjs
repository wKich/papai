import { execSync } from 'node:child_process'

const DEFAULT_TIMEOUT = 30_000
const MAX_OUTPUT_LENGTH = 3000

/**
 * Run a single test file with bun test
 * @param {string} testFilePath - Absolute path to test file
 * @param {string} projectRoot - Project root for cwd
 * @returns {Promise<{ passed: boolean, output: string }>}
 */
export async function runTest(testFilePath, projectRoot) {
  try {
    const output = execSync(`bun test ${testFilePath}`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: DEFAULT_TIMEOUT,
    })
    return { passed: true, output: output.slice(0, MAX_OUTPUT_LENGTH) }
  } catch (error) {
    if (error.killed) {
      return { passed: false, output: `Test timed out after ${DEFAULT_TIMEOUT / 1000}s` }
    }
    const stdout = error.stdout ?? ''
    const stderr = error.stderr ?? ''
    const output = (stdout + '\n' + stderr).trim()
    return { passed: false, output: output.slice(0, MAX_OUTPUT_LENGTH) }
  }
}
