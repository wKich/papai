import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { loadCodeindexConfig } from '../../codeindex/src/config.js'

const tempDirs: string[] = []

const makeTempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeindex-config-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('loadCodeindexConfig', () => {
  test('loads defaults and resolves repo-relative paths', async () => {
    const repoRoot = makeTempDir()
    const configPath = path.join(repoRoot, '.codeindex.json')

    writeFileSync(
      configPath,
      JSON.stringify({
        roots: ['src', 'client'],
        tsconfigPaths: ['tsconfig.json'],
      }),
    )

    const config = await loadCodeindexConfig({
      configPath,
      repoRoot,
    })

    expect(config.repoRoot).toBe(repoRoot)
    expect(config.dbPath).toBe(path.join(repoRoot, '.codeindex', 'index.db'))
    expect(config.indexLocals).toBe(true)
    expect(config.languages).toEqual(['ts', 'tsx', 'js', 'jsx'])
    expect(config.tsconfigPaths).toEqual([path.join(repoRoot, 'tsconfig.json')])
  })
})
