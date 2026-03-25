/**
 * Find all files that transitively import a given module.
 *
 * @param modulePath - The module to find importers for
 * @param importGraph - Map of module -> array of modules that directly import it
 * @returns Array of all files (direct and transitive) that import the module
 */
export function findTransitiveImporters(modulePath: string, importGraph: Map<string, string[]>): string[] {
  const result: string[] = []
  const visited = new Set<string>()
  const queue: string[] = [modulePath]

  while (queue.length > 0) {
    const current = queue.shift()!

    if (visited.has(current)) {
      continue
    }
    visited.add(current)

    // Get files that directly import current
    const directImporters = importGraph.get(current) ?? []

    for (const importer of directImporters) {
      if (!visited.has(importer)) {
        result.push(importer)
        queue.push(importer)
      }
    }
  }

  return result
}
