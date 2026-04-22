import type { SearchResult } from '../types.js'

const scopeScore = (scopeTier: SearchResult['scopeTier']): number => {
  switch (scopeTier) {
    case 'exported':
      return 400
    case 'module':
      return 300
    case 'member':
      return 200
    case 'local':
      return 100
    default:
      throw new Error(`Unsupported scope tier: ${String(scopeTier)}`)
  }
}

const matchScore = (matchReason: string): number => {
  if (matchReason.includes('exact export_names')) {
    return 500
  }
  if (matchReason.includes('exact qualified_name')) {
    return 450
  }
  if (matchReason.includes('exact local_name')) {
    return 425
  }
  return 0
}

export const rerankSearchResults = (results: readonly SearchResult[]): readonly SearchResult[] =>
  [...results].sort(
    (left, right) =>
      matchScore(right.matchReason) +
      scopeScore(right.scopeTier) -
      (matchScore(left.matchReason) + scopeScore(left.scopeTier)),
  )
