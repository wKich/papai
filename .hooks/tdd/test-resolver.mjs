import fs from 'node:fs'
import path from 'node:path'

const IMPL_PATTERN = /\.(?:ts|js|tsx|jsx)$/
const TEST_PATTERN = /\.(?:test|spec)\.(?:ts|js|tsx|jsx)$/

/**
 * Check if a file is a test file
 * @param {string} filePath - File path to check
 * @returns {boolean} True if this is a test file
 */
export function isTestFile(filePath) {
  return TEST_PATTERN.test(filePath)
}

/**
 * Check if a file is a gateable implementation file (src/)
 * @param {string} filePath - File path to check
 * @param {string} projectRoot - Project root directory
 * @returns {boolean} True if this is a gateable implementation file
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
 * Suggest a test file path for an implementation file
 * @param {string} implRelPath - Relative path from projectRoot (e.g. src/foo/bar.ts)
 * @returns {string} Suggested test file relative path (e.g. tests/foo/bar.test.ts)
 */
export function suggestTestPath(implRelPath) {
  // src/foo/bar.ts → tests/foo/bar.test.ts
  const withoutSrc = implRelPath.replace(/^src[/\\]/, '')
  const ext = path.extname(withoutSrc)
  const base = withoutSrc.slice(0, -ext.length)
  return path.join('tests', `${base}.test${ext}`)
}

/**
 * Find the corresponding test file for an implementation file
 * @param {string} implAbsPath - Absolute path to implementation file
 * @param {string} projectRoot - Project root directory
 * @returns {string | null} Absolute path to test file, or null
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

/**
 * Resolve the implementation file path from a test file path
 * @param {string} testRelPath - Relative path from projectRoot (e.g. tests/foo/bar.test.ts)
 * @returns {string} Implementation file relative path (e.g. src/foo/bar.ts)
 */
export function resolveImplPath(testRelPath) {
  const ext = path.extname(testRelPath)
  const base = path.basename(testRelPath, ext).replace(/\.(test|spec)$/, '')

  if (testRelPath.startsWith('tests/') || testRelPath.startsWith('tests\\')) {
    const dir = path.dirname(testRelPath).replace(/^tests[/\\]?/, '')
    return path.join('src', dir, `${base}${ext}`)
  }

  // Colocated test: same directory
  return path.join(path.dirname(testRelPath), `${base}${ext}`)
}

/**
 * Check if a test file imports its corresponding implementation module
 * @param {string} testAbsPath - Absolute path to the test file
 * @param {string} implAbsPath - Absolute path to the implementation file
 * @returns {boolean} True if the test file references the implementation module
 */
export function testFileImportsImpl(testAbsPath, implAbsPath) {
  const content = fs.readFileSync(testAbsPath, 'utf8')
  const testDir = path.dirname(testAbsPath)

  // Calculate relative path from test dir to impl file
  const relToImpl = path.relative(testDir, implAbsPath).replace(/\\/g, '/')
  const noExt = relToImpl.replace(/\.(ts|tsx|js|jsx)$/, '')
  const withJs = noExt + '.js'

  // Check for the impl path as a string literal (covers import, require, mock.module, dynamic import)
  return content.includes(withJs) || content.includes(noExt + "'") || content.includes(noExt + '"')
}
