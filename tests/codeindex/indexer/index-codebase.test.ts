import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { loadCodeindexConfig } from '../../../codeindex/src/config.js'
import { indexCodebase } from '../../../codeindex/src/indexer/index-codebase.js'
import { openDatabase } from '../../../codeindex/src/storage/db.js'
import { ensureSchema } from '../../../codeindex/src/storage/schema.js'

const tempDirs: string[] = []

const makeRepo = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeindex-prune-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('indexCodebase pruning', () => {
  test('full mode removes stale file row and its symbols when a file is deleted', async () => {
    const repoRoot = makeRepo()
    mkdirSync(path.join(repoRoot, 'src'), { recursive: true })
    writeFileSync(path.join(repoRoot, 'src', 'helper.ts'), 'export function helper() { return 1 }\n')
    writeFileSync(path.join(repoRoot, 'src', 'main.ts'), 'export function main() { return 2 }\n')
    writeFileSync(path.join(repoRoot, '.codeindex.json'), JSON.stringify({ roots: ['src'] }))

    const config = await loadCodeindexConfig({
      configPath: path.join(repoRoot, '.codeindex.json'),
      repoRoot,
    })

    await indexCodebase({ config, mode: 'full' })

    unlinkSync(path.join(repoRoot, 'src', 'helper.ts'))

    const summary = await indexCodebase({ config, mode: 'full' })

    expect(summary.filesPruned).toBe(1)
    expect(summary.filesIndexed).toBe(1)

    const db = openDatabase(config.dbPath)
    ensureSchema(db)
    const rows = db
      .query<{ file_path: string }, []>('SELECT file_path FROM files')
      .all()
      .map((r) => r.file_path)
    db.close()

    expect(rows).not.toContain('src/helper.ts')
    expect(rows).toContain('src/main.ts')
  })

  test('incremental mode removes stale file rows when a file is deleted', async () => {
    const repoRoot = makeRepo()
    mkdirSync(path.join(repoRoot, 'src'), { recursive: true })
    writeFileSync(path.join(repoRoot, 'src', 'helper.ts'), 'export function helper() { return 1 }\n')
    writeFileSync(path.join(repoRoot, 'src', 'main.ts'), 'export function main() { return 2 }\n')
    writeFileSync(path.join(repoRoot, '.codeindex.json'), JSON.stringify({ roots: ['src'] }))

    const config = await loadCodeindexConfig({
      configPath: path.join(repoRoot, '.codeindex.json'),
      repoRoot,
    })

    await indexCodebase({ config, mode: 'full' })

    unlinkSync(path.join(repoRoot, 'src', 'helper.ts'))

    const summary = await indexCodebase({ config, mode: 'incremental' })

    expect(summary.filesPruned).toBe(1)

    const db = openDatabase(config.dbPath)
    ensureSchema(db)
    const rows = db
      .query<{ file_path: string }, []>('SELECT file_path FROM files')
      .all()
      .map((r) => r.file_path)
    db.close()

    expect(rows).not.toContain('src/helper.ts')
  })

  test('incremental mode reindexes importers of a deleted file', async () => {
    const repoRoot = makeRepo()
    mkdirSync(path.join(repoRoot, 'src'), { recursive: true })
    writeFileSync(path.join(repoRoot, 'src', 'helper.ts'), 'export function helper() { return 1 }\n')
    writeFileSync(
      path.join(repoRoot, 'src', 'main.ts'),
      "import { helper } from './helper.js'\nexport function main() { return helper() }\n",
    )
    writeFileSync(path.join(repoRoot, '.codeindex.json'), JSON.stringify({ roots: ['src'] }))

    const config = await loadCodeindexConfig({
      configPath: path.join(repoRoot, '.codeindex.json'),
      repoRoot,
    })

    await indexCodebase({ config, mode: 'full' })

    unlinkSync(path.join(repoRoot, 'src', 'helper.ts'))

    const summary = await indexCodebase({ config, mode: 'incremental' })

    expect(summary.filesPruned).toBe(1)
    expect(summary.filesIndexed).toBe(1)
  })

  test('incremental mode reindexes callers when previously-unresolved import becomes resolvable', async () => {
    const repoRoot = makeRepo()
    mkdirSync(path.join(repoRoot, 'src'), { recursive: true })
    writeFileSync(path.join(repoRoot, 'src', 'helper.ts'), 'export function other() { return 0 }\n')
    writeFileSync(
      path.join(repoRoot, 'src', 'main.ts'),
      "import { myFunc } from './helper.js'\nexport function run() { return myFunc() }\n",
    )
    writeFileSync(path.join(repoRoot, '.codeindex.json'), JSON.stringify({ roots: ['src'] }))

    const config = await loadCodeindexConfig({
      configPath: path.join(repoRoot, '.codeindex.json'),
      repoRoot,
    })

    const fullSummary = await indexCodebase({ config, mode: 'full' })
    expect(fullSummary.referencesUnresolved).toBeGreaterThan(0)

    writeFileSync(
      path.join(repoRoot, 'src', 'helper.ts'),
      'export function other() { return 0 }\nexport function myFunc() { return 1 }\n',
    )

    const incrementalSummary = await indexCodebase({ config, mode: 'incremental' })

    expect(incrementalSummary.filesIndexed).toBe(2)
    expect(incrementalSummary.referencesUnresolved).toBe(0)
  })

  test('no pruning occurs when all files still exist', async () => {
    const repoRoot = makeRepo()
    mkdirSync(path.join(repoRoot, 'src'), { recursive: true })
    writeFileSync(path.join(repoRoot, 'src', 'helper.ts'), 'export function helper() { return 1 }\n')
    writeFileSync(path.join(repoRoot, '.codeindex.json'), JSON.stringify({ roots: ['src'] }))

    const config = await loadCodeindexConfig({
      configPath: path.join(repoRoot, '.codeindex.json'),
      repoRoot,
    })

    await indexCodebase({ config, mode: 'full' })
    const summary = await indexCodebase({ config, mode: 'full' })

    expect(summary.filesPruned).toBe(0)
  })
})
