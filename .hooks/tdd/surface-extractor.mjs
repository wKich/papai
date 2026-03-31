import fs from 'node:fs'

/**
 * @typedef {Object} Surface
 * @property {string[]} exports
 * @property {Record<string, number>} signatures
 */

/**
 * Extract public API surface from a TS/JS source file.
 * Returns { exports: string[], signatures: Record<string, number> }
 *
 * Uses regex — accurate enough to detect gross new exports/params.
 * False negatives (e.g. complex dynamic exports) are acceptable; the goal is
 * catching unintentional surface expansion, not 100% coverage of all forms.
 *
 * @param {string} filePath
 * @returns {Surface}
 */
export function extractSurface(filePath) {
  const src = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  const exports = []
  let m

  // export function/class/const/let/var/type/interface/enum Name
  const declPattern = /^export\s+(async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/gm
  while ((m = declPattern.exec(src)) !== null) exports.push(m[2])

  // export default function/class Name
  const defaultNamedPattern = /^export\s+default\s+(?:async\s+)?(?:function|class)\s+(\w+)/gm
  while ((m = defaultNamedPattern.exec(src)) !== null) exports.push(m[1])

  // export default Name (identifier) - captures the name being exported as default
  const defaultIdentifierPattern = /^export\s+default\s+(?!(?:function|class)\s)(\w+)/gm
  while ((m = defaultIdentifierPattern.exec(src)) !== null) exports.push(m[1])

  // export { name1, name2 as alias }
  const namedPattern = /^export\s*\{([^}]+)\}/gm
  while ((m = namedPattern.exec(src)) !== null)
    m[1].split(',').forEach((n) =>
      exports.push(
        n
          .trim()
          .split(/\s+as\s+/)
          .pop(),
      ),
    )

  // export { name1, name2 } from './module'
  // export { default as name } from './module'
  const reExportPattern = /^export\s*\{([^}]+)\}\s+from\s/gm
  while ((m = reExportPattern.exec(src)) !== null)
    m[1].split(',').forEach((n) =>
      exports.push(
        n
          .trim()
          .split(/\s+as\s+/)
          .pop(),
      ),
    )

  // export * from './module' (marks as having re-exports)
  const starReExportPattern = /^export\s+\*\s+from\s/gm
  if (starReExportPattern.test(src)) exports.push('*')

  // parameter counts for named functions (including async)
  const fnPattern = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/gm
  const signatures = {}
  while ((m = fnPattern.exec(src)) !== null) signatures[m[1]] = m[2].trim() === '' ? 0 : m[2].split(',').length

  // export default function name(params) - parameter count
  const defaultFnPattern = /^export\s+default\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/gm
  while ((m = defaultFnPattern.exec(src)) !== null) signatures[m[1]] = m[2].trim() === '' ? 0 : m[2].split(',').length

  // export const/let name = (params) => ... - arrow function parameter count
  const arrowFnPattern = /^export\s+(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/gm
  while ((m = arrowFnPattern.exec(src)) !== null) signatures[m[1]] = m[2].trim() === '' ? 0 : m[2].split(',').length

  return { exports: [...new Set(exports)].sort(), signatures }
}
