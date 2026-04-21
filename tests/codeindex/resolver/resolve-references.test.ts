import { describe, expect, test } from 'bun:test'

import { resolveReferenceCandidates } from '../../../codeindex/src/resolver/resolve-references.js'

describe('resolveReferenceCandidates', () => {
  test('resolvedByName does not cross to a different file when the target file is identified', () => {
    const resolved = resolveReferenceCandidates({
      symbols: [
        { id: 1, qualifiedName: 'src/aaa#helper', localName: 'helper', moduleKey: 'src/aaa', exportNames: ['helper'] },
        {
          id: 2,
          qualifiedName: 'src/helper#helper',
          localName: 'helper',
          moduleKey: 'src/helper',
          exportNames: ['nope'],
        },
      ],
      moduleAliases: [{ aliasKey: 'src/helper', fileId: 20 }],
      files: [
        { id: 10, moduleKey: 'src/aaa' },
        { id: 20, moduleKey: 'src/helper' },
      ],
      references: [
        {
          sourceQualifiedName: null,
          edgeType: 'imports',
          targetName: 'helper',
          targetExportName: 'unknown',
          targetModuleSpecifier: './helper',
          lineNumber: 1,
        },
      ],
      currentModuleKey: 'src/run-task',
    })

    expect(resolved[0]).toMatchObject({ targetSymbolId: 2, confidence: 'file_resolved' })
  })

  test('populates targetFileId when module specifier resolves to a known file even if symbol is absent', () => {
    const resolved = resolveReferenceCandidates({
      symbols: [],
      moduleAliases: [],
      files: [{ id: 10, moduleKey: 'src/helper' }],
      references: [
        {
          sourceQualifiedName: null,
          edgeType: 'imports',
          targetName: 'myFunc',
          targetExportName: 'myFunc',
          targetModuleSpecifier: './helper',
          lineNumber: 1,
        },
      ],
      currentModuleKey: 'src/main',
    })

    expect(resolved).toEqual([expect.objectContaining({ targetSymbolId: null, targetFileId: 10 })])
  })
})
