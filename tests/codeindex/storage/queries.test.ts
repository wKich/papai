import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import type { ExtractedSymbol } from '../../../codeindex/src/indexer/extract-symbols.js'
import {
  findDependentsOfDeletedFiles,
  markParseFailure,
  persistSymbols,
  pruneDeletedFiles,
} from '../../../codeindex/src/storage/queries.js'
import { ensureSchema } from '../../../codeindex/src/storage/schema.js'

const seedFiles = (db: Database, paths: readonly string[]): void => {
  for (const filePath of paths) {
    db.query(
      `INSERT INTO files (file_path, module_key, language, file_hash, parse_status, indexed_at)
       VALUES (?, ?, 'ts', 'abc', 'indexed', datetime('now'))`,
    ).run(filePath, filePath.replace(/\.[^.]+$/, ''))
  }
}

const makeSymbol = (
  overrides: Partial<ExtractedSymbol> & Pick<ExtractedSymbol, 'symbolKey' | 'qualifiedName'>,
): ExtractedSymbol => ({
  localName: 'name',
  kind: 'function_declaration',
  scopeTier: 'exported',
  exportNames: [],
  signatureText: '',
  docText: '',
  bodyText: '',
  identifierTerms: '',
  startLine: 1,
  endLine: 1,
  startByte: 0,
  endByte: 10,
  parentQualifiedName: null,
  ...overrides,
})

describe('persistSymbols', () => {
  test('sets parent_symbol_id for nested symbols', () => {
    const db = new Database(':memory:')
    db.run('PRAGMA foreign_keys = ON')
    ensureSchema(db)
    seedFiles(db, ['src/a.ts'])
    const fileId = db.query<{ id: number }, []>('SELECT id FROM files').get()!.id

    const parent = makeSymbol({ symbolKey: 'src/a.ts#0-50', qualifiedName: 'src/a#Parent', localName: 'Parent' })
    const child = makeSymbol({
      symbolKey: 'src/a.ts#10-40',
      qualifiedName: 'src/a#Parent>method',
      localName: 'method',
      scopeTier: 'member',
      parentQualifiedName: 'src/a#Parent',
    })

    persistSymbols(db, fileId, 'src/a.ts', 'src/a', [parent, child])

    const parentRow = db
      .query<{ id: number }, [string]>('SELECT id FROM symbols WHERE symbol_key = ?')
      .get(parent.symbolKey)!
    const childRow = db
      .query<{ parent_symbol_id: number | null }, [string]>('SELECT parent_symbol_id FROM symbols WHERE symbol_key = ?')
      .get(child.symbolKey)!

    expect(childRow.parent_symbol_id).toBe(parentRow.id)
  })

  test('leaves parent_symbol_id NULL for top-level symbols', () => {
    const db = new Database(':memory:')
    db.run('PRAGMA foreign_keys = ON')
    ensureSchema(db)
    seedFiles(db, ['src/b.ts'])
    const fileId = db.query<{ id: number }, []>('SELECT id FROM files').get()!.id

    const symbol = makeSymbol({ symbolKey: 'src/b.ts#0-20', qualifiedName: 'src/b#Foo', localName: 'Foo' })
    persistSymbols(db, fileId, 'src/b.ts', 'src/b', [symbol])

    const row = db
      .query<{ parent_symbol_id: number | null }, [string]>('SELECT parent_symbol_id FROM symbols WHERE symbol_key = ?')
      .get(symbol.symbolKey)!
    expect(row.parent_symbol_id).toBeNull()
  })
})

describe('findDependentsOfDeletedFiles', () => {
  test('includes callers whose reference has target_file_id set but target_symbol_id null', () => {
    const db = new Database(':memory:')
    db.run('PRAGMA foreign_keys = ON')
    ensureSchema(db)
    seedFiles(db, ['src/helper.ts', 'src/main.ts'])

    const helperId = db
      .query<{ id: number }, [string]>('SELECT id FROM files WHERE file_path = ?')
      .get('src/helper.ts')!.id
    const mainId = db.query<{ id: number }, [string]>('SELECT id FROM files WHERE file_path = ?').get('src/main.ts')!.id

    db.query(
      `INSERT INTO symbol_references
         (source_file_id, target_symbol_id, target_file_id, target_name, edge_type, confidence, line_number)
       VALUES (?, NULL, ?, 'myFunc', 'imports', 'file_resolved', 1)`,
    ).run(mainId, helperId)

    const dependents = findDependentsOfDeletedFiles(db, new Set(['src/main.ts']))

    expect(dependents).toContain('src/main.ts')
  })
})

describe('markParseFailure', () => {
  test('clears stale symbols and aliases when a previously indexed file fails to parse', () => {
    const db = new Database(':memory:')
    db.run('PRAGMA foreign_keys = ON')
    ensureSchema(db)
    seedFiles(db, ['src/a.ts'])
    const fileId = db.query<{ id: number }, []>('SELECT id FROM files').get()!.id

    persistSymbols(db, fileId, 'src/a.ts', 'src/a', [
      makeSymbol({ symbolKey: 'src/a.ts#0-10', qualifiedName: 'src/a#Foo', localName: 'Foo' }),
    ])
    db.query('INSERT INTO module_aliases (file_id, alias_key, alias_kind, precedence) VALUES (?, ?, ?, ?)').run(
      fileId,
      'src/a',
      'module_key',
      0,
    )

    markParseFailure(db, { relativePath: 'src/a.ts' }, 'syntax error')

    const symbols = db.query<{ id: number }, []>('SELECT id FROM symbols').all()
    const aliases = db.query<{ id: number }, []>('SELECT id FROM module_aliases').all()
    const file = db.query<{ parse_status: string }, []>('SELECT parse_status FROM files').get()!

    expect(symbols).toHaveLength(0)
    expect(aliases).toHaveLength(0)
    expect(file.parse_status).toBe('parse_failed')
  })

  test('creates a new file row with parse_failed status for a file that was never indexed', () => {
    const db = new Database(':memory:')
    db.run('PRAGMA foreign_keys = ON')
    ensureSchema(db)

    markParseFailure(db, { relativePath: 'src/new.ts' }, 'parse error')

    const file = db
      .query<{ parse_status: string; parse_error: string }, []>('SELECT parse_status, parse_error FROM files')
      .get()!
    expect(file.parse_status).toBe('parse_failed')
    expect(file.parse_error).toBe('parse error')
  })
})

describe('pruneDeletedFiles', () => {
  test('removes rows whose paths are absent from the discovered set', () => {
    const db = new Database(':memory:')
    db.run('PRAGMA foreign_keys = ON')
    ensureSchema(db)
    seedFiles(db, ['src/a.ts', 'src/b.ts', 'src/c.ts'])

    const pruned = pruneDeletedFiles(db, new Set(['src/a.ts', 'src/c.ts']))

    expect(pruned).toBe(1)
    const remaining = db
      .query<{ file_path: string }, []>('SELECT file_path FROM files')
      .all()
      .map((r) => r.file_path)
    expect(remaining).toEqual(['src/a.ts', 'src/c.ts'])
  })

  test('returns 0 when all stored files are still present', () => {
    const db = new Database(':memory:')
    db.run('PRAGMA foreign_keys = ON')
    ensureSchema(db)
    seedFiles(db, ['src/a.ts'])

    const pruned = pruneDeletedFiles(db, new Set(['src/a.ts']))

    expect(pruned).toBe(0)
  })

  test('removes all rows when discovered set is empty', () => {
    const db = new Database(':memory:')
    db.run('PRAGMA foreign_keys = ON')
    ensureSchema(db)
    seedFiles(db, ['src/a.ts', 'src/b.ts'])

    const pruned = pruneDeletedFiles(db, new Set())

    expect(pruned).toBe(2)
    const remaining = db.query<{ file_path: string }, []>('SELECT file_path FROM files').all()
    expect(remaining).toHaveLength(0)
  })
})
