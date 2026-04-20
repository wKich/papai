import { describe, expect, test } from 'bun:test'

import { buildModuleIdentity } from '../../codeindex/src/resolver/module-specifiers.js'

describe('buildModuleIdentity', () => {
  test('keeps canonical index module keys and adds import-facing alias', () => {
    const identity = buildModuleIdentity('src/foo/index.ts')

    expect(identity.moduleKey).toBe('src/foo/index')
    expect(identity.aliases).toEqual([
      { aliasKey: 'src/foo/index', aliasKind: 'extensionless', precedence: 100 },
      { aliasKey: 'src/foo', aliasKind: 'index_collapse', precedence: 90 },
    ])
  })
})
