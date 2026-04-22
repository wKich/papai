import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { loadCodeindexConfig } from '../../codeindex/src/config.js'
import { indexCodebase } from '../../codeindex/src/indexer/index-codebase.js'

const tempDirs: string[] = []

const makeRepo = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeindex-index-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('indexCodebase', () => {
  test('indexes a small repo and reports counts', async () => {
    const repoRoot = makeRepo()
    mkdirSync(path.join(repoRoot, 'src'), { recursive: true })
    writeFileSync(path.join(repoRoot, 'src', 'helper.ts'), 'export function helper() { return 1 }\n')
    writeFileSync(
      path.join(repoRoot, 'src', 'run-task.ts'),
      "import { helper } from './helper'\nexport function runTask() { return helper() }\n",
    )
    writeFileSync(path.join(repoRoot, '.codeindex.json'), JSON.stringify({ roots: ['src'] }))

    const config = await loadCodeindexConfig({
      configPath: path.join(repoRoot, '.codeindex.json'),
      repoRoot,
    })

    const summary = await indexCodebase({ config, mode: 'full' })

    expect(summary.filesIndexed).toBe(2)
    expect(summary.symbolsIndexed).toBeGreaterThanOrEqual(2)
    expect(summary.referencesIndexed).toBeGreaterThanOrEqual(1)
    expect(summary.filesFailed).toBe(0)
  })

  test('incremental mode reindexes changed files and narrow dependents without full rebuild', async () => {
    const repoRoot = makeRepo()
    mkdirSync(path.join(repoRoot, 'src'), { recursive: true })
    writeFileSync(path.join(repoRoot, 'src', 'helper.ts'), 'export function helper() { return 1 }\n')
    writeFileSync(
      path.join(repoRoot, 'src', 'run-task.ts'),
      "import { helper } from './helper'\nexport function runTask() { return helper() }\n",
    )
    writeFileSync(path.join(repoRoot, 'src', 'unrelated.ts'), 'export const unrelated = 1\n')
    writeFileSync(path.join(repoRoot, '.codeindex.json'), JSON.stringify({ roots: ['src'] }))

    const config = await loadCodeindexConfig({
      configPath: path.join(repoRoot, '.codeindex.json'),
      repoRoot,
    })

    await indexCodebase({ config, mode: 'full' })

    writeFileSync(path.join(repoRoot, 'src', 'helper.ts'), 'export function helperRenamed() { return 2 }\n')

    const summary = await indexCodebase({ config, mode: 'incremental' })
    expect(summary.filesIndexed).toBe(2)
    expect(summary.filesFailed).toBe(0)
  })
})
