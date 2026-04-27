import { describe, expect, test } from 'bun:test'

import { rerankSearchResults } from '../../codeindex/src/search.js'

describe('rerankSearchResults', () => {
  test('prefers exported and module-level hits over locals', () => {
    const ranked = rerankSearchResults([
      {
        symbolKey: 'a',
        qualifiedName: 'src/foo#helper',
        localName: 'helper',
        kind: 'function_declaration',
        scopeTier: 'local',
        filePath: 'src/foo.ts',
        startLine: 1,
        endLine: 1,
        exportNames: [],
        matchReason: 'exact local_name',
        confidence: 'resolved',
        snippet: 'function helper() {}',
      },
      {
        symbolKey: 'b',
        qualifiedName: 'src/bar#helper',
        localName: 'helper',
        kind: 'function_declaration',
        scopeTier: 'exported',
        filePath: 'src/bar.ts',
        startLine: 1,
        endLine: 1,
        exportNames: ['helper'],
        matchReason: 'exact export_names',
        confidence: 'resolved',
        snippet: 'export function helper() {}',
      },
    ])

    expect(ranked.map((entry) => entry.symbolKey)).toEqual(['b', 'a'])
  })
})
