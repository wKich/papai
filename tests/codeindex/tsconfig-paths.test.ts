import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expandTsconfigAliasesForFile, loadTsconfigPathAliases } from '../../codeindex/src/resolver/tsconfig-paths.js'

const tempDirs: string[] = []

const makeTempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeindex-tsconfig-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('loadTsconfigPathAliases', () => {
  test('expands baseUrl and paths into alias rules', async () => {
    const repoRoot = makeTempDir()
    const tsconfigPath = path.join(repoRoot, 'tsconfig.json')
    writeFileSync(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*'],
          },
        },
      }),
    )

    const aliases = await loadTsconfigPathAliases([tsconfigPath])

    expect(aliases).toEqual([
      {
        pattern: '@/*',
        replacements: [path.join(repoRoot, 'src/*')],
      },
    ])

    expect(expandTsconfigAliasesForFile(path.join(repoRoot, 'src', 'db', 'drizzle.ts'), aliases)).toEqual([
      { aliasKey: '@/db/drizzle', aliasKind: 'tsconfig_path', precedence: 80 },
    ])
  })
})
