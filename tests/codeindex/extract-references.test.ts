import { describe, expect, test } from 'bun:test'

import { extractReferenceCandidates } from '../../codeindex/src/indexer/extract-references.js'
import { createParserLoader } from '../../codeindex/src/indexer/parser.js'

describe('extractReferenceCandidates', () => {
  test('captures imports, reexports, and call references', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = [
      "import { helper } from './helper.js'",
      "export { helper as publicHelper } from './helper.js'",
      'export function runTask() {',
      '  return helper()',
      '}',
    ].join('\n')

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()
    if (tree === null) {
      throw new Error('Expected parser to produce a tree')
    }
    const references = extractReferenceCandidates({
      source,
      tree,
      relativeFilePath: 'src/run-task.ts',
      moduleKey: 'src/run-task',
    })

    expect(references.moduleExports).toEqual([
      {
        exportName: 'publicHelper',
        exportKind: 'reexport',
        localName: 'helper',
        targetModuleSpecifier: './helper.js',
      },
      {
        exportName: 'runTask',
        exportKind: 'named',
        localName: 'runTask',
        targetModuleSpecifier: null,
      },
    ])
    expect(
      references.references.some(
        (reference) =>
          reference.edgeType === 'imports' &&
          reference.targetName === 'helper' &&
          reference.targetModuleSpecifier === './helper.js',
      ),
    ).toBe(true)
    expect(
      references.references.some((reference) => reference.edgeType === 'calls' && reference.targetName === 'helper'),
    ).toBe(true)
  })
})
