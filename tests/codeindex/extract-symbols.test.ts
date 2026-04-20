import { describe, expect, test } from 'bun:test'

import { extractSymbolsFromSource } from '../../codeindex/src/indexer/extract-symbols.js'
import { createParserLoader } from '../../codeindex/src/indexer/parser.js'

describe('extractSymbolsFromSource', () => {
  test('extracts exported, member, and local symbols with normalized identifier terms', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = [
      '/** Build database client */',
      'export function getDrizzleDb() {',
      '  function makeInnerHelper() {',
      '    const storage_context_id = 1',
      '    return storage_context_id',
      '  }',
      '  return makeInnerHelper()',
      '}',
    ].join('\n')

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()
    if (tree === null) {
      throw new Error('Expected parser to produce a tree')
    }
    const symbols = extractSymbolsFromSource({
      source,
      tree,
      relativeFilePath: 'src/db/drizzle.ts',
      moduleKey: 'src/db/drizzle',
      maxStoredBodyLines: 120,
      includeDocComments: true,
    })

    expect(symbols.map((symbol) => symbol.qualifiedName)).toEqual([
      'src/db/drizzle#getDrizzleDb',
      'src/db/drizzle#getDrizzleDb>makeInnerHelper',
      'src/db/drizzle#getDrizzleDb>makeInnerHelper>storage_context_id',
    ])
    expect(symbols[0]?.scopeTier).toBe('exported')
    expect(symbols[0]?.docText).toContain('Build database client')
    expect(symbols[0]?.identifierTerms).toContain('get drizzle db')
    expect(symbols[2]?.identifierTerms).toContain('storage context id')
  })
})
