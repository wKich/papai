import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { discoverSourceFiles } from '../../codeindex/src/indexer/discover.js'

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
  test('respects gitignore and explicit excludes', async () => {
    const repoRoot = makeTempRepo()
    mkdirSync(path.join(repoRoot, 'src'), { recursive: true })
    mkdirSync(path.join(repoRoot, 'coverage'), { recursive: true })
    writeFileSync(path.join(repoRoot, '.gitignore'), 'ignored.ts\n')
    writeFileSync(path.join(repoRoot, 'src', 'kept.ts'), 'export const kept = 1\n')
    writeFileSync(path.join(repoRoot, 'ignored.ts'), 'export const ignored = 1\n')
    writeFileSync(path.join(repoRoot, 'coverage', 'skip.ts'), 'export const skip = 1\n')
    writeFileSync(path.join(repoRoot, 'src', 'skip.test.ts'), 'export const testOnly = 1\n')

    const files = await discoverSourceFiles({
      repoRoot,
      roots: [path.join(repoRoot, 'src')],
      exclude: ['coverage', '**/*.test.*'],
      languages: ['ts', 'tsx', 'js', 'jsx'],
    })

    expect(files.map((entry) => path.relative(repoRoot, entry.absolutePath))).toEqual(['src/kept.ts'])
  })
})
