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
  // Must be under src/, client/, or codeindex/src/, match IMPL_PATTERN, and NOT match TEST_PATTERN
  const rel = path.relative(projectRoot, path.resolve(projectRoot, filePath))
  const isSrc = rel.startsWith('src/') || rel.startsWith('src\\')
  const isClient = rel.startsWith('client/') || rel.startsWith('client\\')
  const isCodeindex = rel.startsWith('codeindex/src/') || rel.startsWith('codeindex\\src\\')
  if (!isSrc && !isClient && !isCodeindex) return false
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
  // client/debug/helpers.ts → tests/client/debug/helpers.test.ts (keep client/ prefix)
  if (implRelPath.startsWith('client/') || implRelPath.startsWith('client\\')) {
    const ext = path.extname(implRelPath)
    const base = implRelPath.slice(0, -ext.length)
    return path.join('tests', `${base}.test${ext}`)
  }
  // codeindex/src/foo/bar.ts → tests/codeindex/foo/bar.test.ts (strip codeindex/src/ prefix)
  if (implRelPath.startsWith('codeindex/src/') || implRelPath.startsWith('codeindex\\src\\')) {
    const withoutCodeindexSrc = implRelPath.replace(/^codeindex[/\\]src[/\\]/, '')
    const ext = path.extname(withoutCodeindexSrc)
    const base = withoutCodeindexSrc.slice(0, -ext.length)
    return path.join('tests', 'codeindex', `${base}.test${ext}`)
  }
  // src/foo/bar.ts → tests/foo/bar.test.ts (strip src/ prefix)
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

  // Client files: client/debug/helpers.ts → tests/client/debug/helpers.test.ts
  if (rel.startsWith('client/') || rel.startsWith('client\\')) {
    const ext = path.extname(rel)
    const base = rel.slice(0, -ext.length)

    for (const suffix of ['.test', '.spec']) {
      const candidate = path.join(projectRoot, 'tests', `${base}${suffix}${ext}`)
      if (fs.existsSync(candidate)) return candidate
    }
  }

  // codeindex/src/foo/bar.ts → tests/codeindex/foo/bar.test.ts
  if (rel.startsWith('codeindex/src/') || rel.startsWith('codeindex\\src\\')) {
    const withoutCodeindexSrc = rel.replace(/^codeindex[/\\]src[/\\]/, '')
    const ext = path.extname(withoutCodeindexSrc)
    const base = withoutCodeindexSrc.slice(0, -ext.length)

    for (const suffix of ['.test', '.spec']) {
      const candidate = path.join(projectRoot, 'tests', 'codeindex', `${base}${suffix}${ext}`)
      if (fs.existsSync(candidate)) return candidate
    }
  }

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
    // tests/client/debug/helpers.test.ts → client/debug/helpers.ts (client/ stays)
    if (dir.startsWith('client/') || dir.startsWith('client\\') || dir === 'client') {
      return path.join(dir, `${base}${ext}`)
    }
    // tests/scripts/foo.test.ts → scripts/foo.ts (scripts/ at root — bug fix for old src/scripts/* mapping; scripts/ is NOT a gateable source root)
    if (dir.startsWith('scripts/') || dir.startsWith('scripts\\') || dir === 'scripts') {
      return path.join(dir, `${base}${ext}`)
    }
    // tests/codeindex/foo/bar.test.ts → codeindex/src/foo/bar.ts
    if (dir.startsWith('codeindex/') || dir.startsWith('codeindex\\') || dir === 'codeindex') {
      const withoutCodeindex = dir.replace(/^codeindex[/\\]?/, '')
      return path.join('codeindex', 'src', withoutCodeindex, `${base}${ext}`)
    }
    // tests/foo/bar.test.ts → src/foo/bar.ts (prepend src/)
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
