import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { runFtsSearch } from '../../../codeindex/src/search/fts.js'
import { ensureSchema } from '../../../codeindex/src/storage/schema.js'

const makeDb = (localName: string): Database => {
  const db = new Database(':memory:')
  ensureSchema(db)
  db.run(
    `INSERT INTO files (id, file_path, module_key, language, file_hash, parse_status, parse_error, indexed_at)
     VALUES (1, 'src/db/drizzle.ts', 'src/db/drizzle', 'ts', 'x', 'indexed', NULL, datetime('now'))`,
  )
  db.run(
    `INSERT INTO symbols (id, file_id, file_path, module_key, symbol_key, local_name, qualified_name, kind, scope_tier, parent_symbol_id, is_exported, export_names, signature_text, doc_text, body_text, identifier_terms, start_line, end_line, start_byte, end_byte)
     VALUES (1, 1, 'src/db/drizzle.ts', 'src/db/drizzle', 'src/db/drizzle.ts#0-20', ?, ?, 'function_declaration', 'exported', NULL, 1, ?, '', '', '', ?, 1, 1, 0, 20)`,
    [localName, `src/db/drizzle#${localName}`, JSON.stringify([localName]), localName],
  )
  return db
}

describe('runFtsSearch', () => {
  test('returns results for a plain identifier query', () => {
    const db = makeDb('getDrizzleDb')
    const results = runFtsSearch(db, 'getDrizzleDb', 10, {})
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.localName).toBe('getDrizzleDb')
  })

  test('does not throw for a call-expression query like getDrizzleDb()', () => {
    const db = makeDb('getDrizzleDb')
    expect(() => runFtsSearch(db, 'getDrizzleDb()', 10, {})).not.toThrow()
  })

  test('strips trailing parens and still matches the symbol', () => {
    const db = makeDb('getDrizzleDb')
    const results = runFtsSearch(db, 'getDrizzleDb()', 10, {})
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.localName).toBe('getDrizzleDb')
  })

  test('returns empty array instead of throwing for a query of only metacharacters', () => {
    const db = makeDb('getDrizzleDb')
    expect(() => runFtsSearch(db, '()', 10, {})).not.toThrow()
    expect(runFtsSearch(db, '()', 10, {})).toEqual([])
  })

  test('does not throw for a query with an unbalanced double-quote', () => {
    const db = makeDb('getDrizzleDb')
    expect(() => runFtsSearch(db, '"getDrizzleDb', 10, {})).not.toThrow()
  })

  test('does not throw for a path query like src/db/drizzle', () => {
    const db = makeDb('getDrizzleDb')
    expect(() => runFtsSearch(db, 'src/db/drizzle', 10, {})).not.toThrow()
  })

  test('does not throw for a qualified-name query like src/db/drizzle#getDrizzleDb', () => {
    const db = makeDb('getDrizzleDb')
    expect(() => runFtsSearch(db, 'src/db/drizzle#getDrizzleDb', 10, {})).not.toThrow()
  })

  test('strips path separators and still matches by identifier', () => {
    const db = makeDb('getDrizzleDb')
    const results = runFtsSearch(db, 'src/db/drizzle#getDrizzleDb', 10, {})
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.localName).toBe('getDrizzleDb')
  })

  test('applies filters to fts results', () => {
    const db = makeDb('getDrizzleDb')
    const results = runFtsSearch(db, 'getDrizzleDb', 10, { kinds: ['variable_declaration'] })
    expect(results).toEqual([])
  })
})
