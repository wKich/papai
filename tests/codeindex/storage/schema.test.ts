import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { ensureSchema } from '../../../codeindex/src/storage/schema.js'

describe('ensureSchema', () => {
  test('symbol_references table has target_file_id column', () => {
    const db = new Database(':memory:')
    ensureSchema(db)

    const columns = db
      .query<{ name: string }, []>('PRAGMA table_info(symbol_references)')
      .all()
      .map((row) => row.name)

    expect(columns).toContain('target_file_id')
  })

  test('migrates stale database missing target_file_id without error', () => {
    const db = new Database(':memory:')
    // Simulate a pre-migration database: create symbol_references without target_file_id
    db.run(`CREATE TABLE files (
      id INTEGER PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      module_key TEXT NOT NULL UNIQUE,
      language TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      parse_status TEXT NOT NULL,
      parse_error TEXT,
      indexed_at TEXT NOT NULL
    )`)
    db.run(`CREATE TABLE symbol_references (
      id INTEGER PRIMARY KEY,
      source_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      target_name TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      confidence TEXT NOT NULL,
      line_number INTEGER NOT NULL
    )`)

    expect(() => ensureSchema(db)).not.toThrow()

    const columns = db
      .query<{ name: string }, []>('PRAGMA table_info(symbol_references)')
      .all()
      .map((row) => row.name)

    expect(columns).toContain('target_file_id')
  })
})
