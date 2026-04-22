import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { ensureSchema } from '../../codeindex/src/storage/schema.js'

describe('ensureSchema', () => {
  test('creates symbol tables and FTS triggers', () => {
    const db = new Database(':memory:')

    ensureSchema(db)

    const tableNames = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name)

    const triggerNames = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
      .all()
      .map((row) => row.name)

    expect(tableNames).toContain('files')
    expect(tableNames).toContain('module_aliases')
    expect(tableNames).toContain('symbols')
    expect(tableNames).toContain('module_exports')
    expect(tableNames).toContain('symbol_references')
    expect(tableNames).toContain('symbol_fts')
    expect(triggerNames).toContain('symbols_ad')
    expect(triggerNames).toContain('symbols_ai')
    expect(triggerNames).toContain('symbols_au')
  })
})
