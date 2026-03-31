import fs from 'node:fs'

/**
 * Extract public API surface from a TS/JS source file.
 * Returns { exports: string[], signatures: Record<string, number> }
 *
 * Uses regex — accurate enough to detect gross new exports/params.
 * False negatives (e.g. arrow-function exports) are acceptable; the goal is
 * catching unintentional surface expansion, not 100% coverage of all forms.
 */
export function extractSurface(filePath) {
  const src = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  const exports = []
  let m

  // export function/class/const/let/var/type/interface/enum Name
  const declPattern = /^export\s+(async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/gm
  while ((m = declPattern.exec(src)) !== null) exports.push(m[2])

  // export { name1, name2 as alias }
  const namedPattern = /^export\s*\{([^}]+)\}/gm
  while ((m = namedPattern.exec(src)) !== null)
    m[1].split(',').forEach((n) => exports.push(n.trim().split(/\s+as\s+/).pop()))

  // parameter counts for named functions
  const fnPattern = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/gm
  const signatures = {}
  while ((m = fnPattern.exec(src)) !== null)
    signatures[m[1]] = m[2].trim() === '' ? 0 : m[2].split(',').length

  return { exports: [...new Set(exports)].sort(), signatures }
}
