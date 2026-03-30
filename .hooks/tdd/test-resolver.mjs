import fs from 'node:fs'
import path from 'node:path'

const IMPL_PATTERN = /\.(?:ts|js|tsx|jsx)$/
const TEST_PATTERN = /\.(?:test|spec)\.(?:ts|js|tsx|jsx)$/

/**
 * @param {string} filePath - File path to check
 * @returns {boolean} - True if this is a test file
 */
export function isTestFile(filePath) {
  return TEST_PATTERN.test(filePath)
}

/**
 * @param {string} filePath - File path to check
 * @param {string} projectRoot - Project root directory
 * @returns {boolean} - True if this is a gateable implementation file (src/ **\/ *.ts)
 */
export function isGateableImplFile(filePath, projectRoot) {
  // Must be under src/, match IMPL_PATTERN, and NOT match TEST_PATTERN
  const rel = path.relative(projectRoot, path.resolve(projectRoot, filePath))
  if (!rel.startsWith('src/') && !rel.startsWith('src\\')) return false
  if (!IMPL_PATTERN.test(rel)) return false
  if (TEST_PATTERN.test(rel)) return false
  return true
}

/**
 * @param {string} implRelPath - Relative path from projectRoot (e.g. src/foo/bar.ts)
 * @returns {string} - Suggested test file relative path (e.g. tests/foo/bar.test.ts)
 */
export function suggestTestPath(implRelPath) {
  // src/foo/bar.ts → tests/foo/bar.test.ts
  const withoutSrc = implRelPath.replace(/^src[/\\]/, '')
  const ext = path.extname(withoutSrc)
  const base = withoutSrc.slice(0, -ext.length)
  return path.join('tests', `${base}.test${ext}`)
}

/**
 * @param {string} implAbsPath - Absolute path to implementation file
 * @param {string} projectRoot - Project root directory
 * @returns {string|null} - Absolute path to test file, or null
 */
export function findTestFile(implAbsPath, projectRoot) {
  const rel = path.relative(projectRoot, implAbsPath)

  // Primary: parallel tests/ directory (src/foo/bar.ts → tests/foo/bar.test.ts)
  if (rel.startsWith('src/') || rel.startsWith('src\\')) {
    const withoutSrc = rel.replace(/^src[/\\]/, '')
    const ext = path.extname(withoutSrc)
    const base = withoutSrc.slice(0, -ext.length)

    for (const suffix of ['.test', '.spec']) {
      const candidate = path.join(projectRoot, 'tests', `${base}${suffix}${ext}`)
      if (fs.existsSync(candidate)) return candidate
    }
  }

  // Fallback: colocated test file (same directory)
  const dir = path.dirname(implAbsPath)
  const ext = path.extname(implAbsPath)
  const baseName = path.basename(implAbsPath, ext)

  for (const suffix of ['.test', '.spec']) {
    const candidate = path.join(dir, `${baseName}${suffix}${ext}`)
    if (fs.existsSync(candidate)) return candidate
  }

  return null
}
