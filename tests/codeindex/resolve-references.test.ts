import { describe, expect, test } from 'bun:test'

import { resolveReferenceCandidates } from '../../codeindex/src/resolver/resolve-references.js'

describe('resolveReferenceCandidates', () => {
  test('prefers exact module export matches over name-only fallback', () => {
    const resolved = resolveReferenceCandidates({
      symbols: [
        {
          id: 1,
          qualifiedName: 'src/helper#helper',
          localName: 'helper',
          moduleKey: 'src/helper',
          exportNames: ['helper'],
        },
      ],
      moduleAliases: [{ aliasKey: 'src/helper', fileId: 10 }],
      files: [{ id: 10, moduleKey: 'src/helper' }],
      references: [
        {
          sourceQualifiedName: 'src/run-task#runTask',
          edgeType: 'imports',
          targetName: 'helper',
          targetExportName: 'helper',
          targetModuleSpecifier: './helper',
          lineNumber: 1,
        },
        {
          sourceQualifiedName: 'src/run-task#runTask',
          edgeType: 'calls',
          targetName: 'helper',
          targetExportName: null,
          targetModuleSpecifier: null,
          lineNumber: 3,
        },
      ],
      currentModuleKey: 'src/run-task',
    })

    expect(resolved).toEqual([
      expect.objectContaining({ edgeType: 'imports', targetSymbolId: 1, confidence: 'resolved' }),
      expect.objectContaining({ edgeType: 'calls', targetSymbolId: 1, confidence: 'resolved' }),
    ])
  })
})
