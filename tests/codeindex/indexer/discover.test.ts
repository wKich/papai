import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { discoverSourceFiles } from '../../../codeindex/src/indexer/discover.js'

const tempDirs: string[] = []

const makeTempRepo = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeindex-discover-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('discoverSourceFiles', () => {
  test('skips a configured root that does not exist instead of throwing', async () => {
    const repoRoot = makeTempRepo()
    mkdirSync(path.join(repoRoot, 'src'), { recursive: true })
    writeFileSync(path.join(repoRoot, 'src', 'main.ts'), 'export const main = 1\n')

    const files = await discoverSourceFiles({
      repoRoot,
      roots: [path.join(repoRoot, 'src'), path.join(repoRoot, 'client')],
      exclude: [],
      languages: ['ts', 'tsx', 'js', 'jsx'],
    })

    expect(files.map((entry) => path.relative(repoRoot, entry.absolutePath))).toEqual(['src/main.ts'])
  })
})
