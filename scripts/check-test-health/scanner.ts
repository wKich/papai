import { existsSync } from 'fs'
import { dirname, resolve } from 'path'

import ts from 'typescript'

/**
 * Extract imports from a TypeScript source file.
 */
export function extractImportsFromSource(filePath: string, sourceText: string): string[] {
  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)
  const imports: string[] = []

  function walk(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      // Skip type-only imports
      if (node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword) return

      const { moduleSpecifier } = node
      if (!ts.isStringLiteral(moduleSpecifier)) return

      const resolved = resolveImportSpecifier(filePath, moduleSpecifier.text)
      if (resolved !== null) {
        imports.push(resolved)
      }
    }
    ts.forEachChild(node, walk)
  }

  walk(sf)
  return imports
}

/**
 * Resolve an import specifier to an absolute path.
 */
function resolveImportSpecifier(fromFile: string, specifier: string): string | null {
  // External packages - skip
  if (!specifier.startsWith('.')) return null

  const fromDir = dirname(fromFile)
  const base = resolve(fromDir, specifier)

  // Try common TypeScript extensions
  const candidates = [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}/index.ts`]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

/**
 * Build import graph: module -> array of files that import it.
 * Only includes modules with absolute paths (resolved project-local imports).
 */
export function buildImportGraph(files: Array<{ path: string; imports: string[] }>): Map<string, string[]> {
  const graph = new Map<string, string[]>()

  for (const file of files) {
    for (const importedModule of file.imports) {
      // Only track absolute paths (resolved project-local modules)
      if (!importedModule.startsWith('/')) continue

      if (!graph.has(importedModule)) {
        graph.set(importedModule, [])
      }
      graph.get(importedModule)!.push(file.path)
    }
  }

  return graph
}
