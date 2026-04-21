import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  expandTsconfigAliasesForFile,
  loadTsconfigPathAliases,
} from '../../../codeindex/src/resolver/tsconfig-paths.js'

describe('loadTsconfigPathAliases', () => {
  test('resolves baseUrl from parent config when child does not declare it', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'tsconfig-test-'))
    const childDir = path.join(root, 'packages', 'app')
    mkdirSync(childDir, { recursive: true })

    writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } } }),
    )
    writeFileSync(path.join(childDir, 'tsconfig.json'), JSON.stringify({ extends: '../../tsconfig.json' }))

    const rules = loadTsconfigPathAliases([path.join(childDir, 'tsconfig.json')])

    expect(rules).toHaveLength(1)
    expect(rules[0]!.pattern).toBe('@app/*')
    expect(rules[0]!.replacements[0]).toBe(path.join(root, 'src', '*'))
  })

  test('resolves baseUrl from own config when child declares it', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'tsconfig-test-'))
    const childDir = path.join(root, 'packages', 'app')
    mkdirSync(childDir, { recursive: true })

    writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@root/*': ['src/*'] } } }),
    )
    writeFileSync(
      path.join(childDir, 'tsconfig.json'),
      JSON.stringify({
        extends: '../../tsconfig.json',
        compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } },
      }),
    )

    const rules = loadTsconfigPathAliases([path.join(childDir, 'tsconfig.json')])

    expect(rules).toHaveLength(1)
    expect(rules[0]!.pattern).toBe('@app/*')
    expect(rules[0]!.replacements[0]).toBe(path.join(childDir, 'src', '*'))
  })
})

describe('expandTsconfigAliasesForFile', () => {
  test('maps file to alias key using inherited baseUrl', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'tsconfig-test-'))
    const childDir = path.join(root, 'packages', 'app')
    mkdirSync(childDir, { recursive: true })

    writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } } }),
    )
    writeFileSync(path.join(childDir, 'tsconfig.json'), JSON.stringify({ extends: '../../tsconfig.json' }))

    const rules = loadTsconfigPathAliases([path.join(childDir, 'tsconfig.json')])
    const aliases = expandTsconfigAliasesForFile(path.join(root, 'src', 'utils', 'foo.ts'), rules)

    expect(aliases).toHaveLength(1)
    expect(aliases[0]!.aliasKey).toBe('@app/utils/foo')
    expect(aliases[0]!.aliasKind).toBe('tsconfig_path')
  })
})
