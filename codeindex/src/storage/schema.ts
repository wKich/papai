import type { Database } from 'bun:sqlite'

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY,
    file_path TEXT NOT NULL UNIQUE,
    module_key TEXT NOT NULL UNIQUE,
    language TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    parse_status TEXT NOT NULL,
    parse_error TEXT,
    indexed_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS module_aliases (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    alias_key TEXT NOT NULL,
    alias_kind TEXT NOT NULL,
    precedence INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS symbols (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    module_key TEXT NOT NULL,
    symbol_key TEXT NOT NULL UNIQUE,
    local_name TEXT NOT NULL,
    qualified_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    scope_tier TEXT NOT NULL,
    parent_symbol_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
    is_exported INTEGER NOT NULL,
    export_names TEXT NOT NULL,
    signature_text TEXT NOT NULL,
    doc_text TEXT NOT NULL,
    body_text TEXT NOT NULL,
    identifier_terms TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    start_byte INTEGER NOT NULL,
    end_byte INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS module_exports (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    export_name TEXT NOT NULL,
    export_kind TEXT NOT NULL,
    symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
    target_module_specifier TEXT,
    resolved_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS symbol_references (
    id INTEGER PRIMARY KEY,
    source_symbol_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
    source_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    target_symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
    target_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
    target_name TEXT NOT NULL,
    target_export_name TEXT,
    target_module_specifier TEXT,
    edge_type TEXT NOT NULL,
    confidence TEXT NOT NULL,
    line_number INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_module_aliases_alias_key ON module_aliases(alias_key)',
  'CREATE INDEX IF NOT EXISTS idx_module_aliases_file_id ON module_aliases(file_id)',
  'CREATE INDEX IF NOT EXISTS idx_symbols_local_name ON symbols(local_name)',
  'CREATE INDEX IF NOT EXISTS idx_symbols_qualified_name ON symbols(qualified_name)',
  'CREATE INDEX IF NOT EXISTS idx_symbols_scope_tier ON symbols(scope_tier)',
  'CREATE INDEX IF NOT EXISTS idx_symbols_file_id ON symbols(file_id)',
  'CREATE INDEX IF NOT EXISTS idx_symbols_parent_symbol_id ON symbols(parent_symbol_id)',
  'CREATE INDEX IF NOT EXISTS idx_module_exports_file_id ON module_exports(file_id)',
  'CREATE INDEX IF NOT EXISTS idx_module_exports_export_name ON module_exports(export_name)',
  'CREATE INDEX IF NOT EXISTS idx_module_exports_symbol_id ON module_exports(symbol_id)',
  'CREATE INDEX IF NOT EXISTS idx_module_exports_resolved_file_id ON module_exports(resolved_file_id)',
  'CREATE INDEX IF NOT EXISTS idx_symbol_references_source_symbol_id ON symbol_references(source_symbol_id)',
  'CREATE INDEX IF NOT EXISTS idx_symbol_references_target_symbol_id ON symbol_references(target_symbol_id)',
  'CREATE INDEX IF NOT EXISTS idx_symbol_references_target_file_id ON symbol_references(target_file_id)',
  'CREATE INDEX IF NOT EXISTS idx_symbol_references_target_name ON symbol_references(target_name)',
  'CREATE INDEX IF NOT EXISTS idx_symbol_references_edge_type ON symbol_references(edge_type)',
  'CREATE INDEX IF NOT EXISTS idx_symbol_references_confidence ON symbol_references(confidence)',
]

const ftsStatements = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS symbol_fts USING fts5(
    local_name,
    qualified_name,
    export_names,
    identifier_terms,
    signature_text,
    doc_text,
    body_text,
    file_path,
    content='symbols',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 1 tokenchars ''_-''',
    prefix='2 3'
  )`,
  `CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
    INSERT INTO symbol_fts(rowid, local_name, qualified_name, export_names, identifier_terms, signature_text, doc_text, body_text, file_path)
    VALUES (new.id, new.local_name, new.qualified_name, new.export_names, new.identifier_terms, new.signature_text, new.doc_text, new.body_text, new.file_path);
  END`,
  `CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
    INSERT INTO symbol_fts(symbol_fts, rowid, local_name, qualified_name, export_names, identifier_terms, signature_text, doc_text, body_text, file_path)
    VALUES ('delete', old.id, old.local_name, old.qualified_name, old.export_names, old.identifier_terms, old.signature_text, old.doc_text, old.body_text, old.file_path);
  END`,
  `CREATE TRIGGER IF NOT EXISTS symbols_au AFTER UPDATE ON symbols BEGIN
    INSERT INTO symbol_fts(symbol_fts, rowid, local_name, qualified_name, export_names, identifier_terms, signature_text, doc_text, body_text, file_path)
    VALUES ('delete', old.id, old.local_name, old.qualified_name, old.export_names, old.identifier_terms, old.signature_text, old.doc_text, old.body_text, old.file_path);
    INSERT INTO symbol_fts(rowid, local_name, qualified_name, export_names, identifier_terms, signature_text, doc_text, body_text, file_path)
    VALUES (new.id, new.local_name, new.qualified_name, new.export_names, new.identifier_terms, new.signature_text, new.doc_text, new.body_text, new.file_path);
  END`,
]

// Bump when any table/column/index definition changes; ensureSchema will wipe and rebuild.
const SCHEMA_VERSION = 1

const DROP_ORDER = ['symbol_fts', 'symbol_references', 'module_exports', 'symbols', 'module_aliases', 'files']

const runStatements = (db: Database, statements: readonly string[]): void => {
  for (const statement of statements) {
    db.run(statement)
  }
}

export const ensureSchema = (db: Database): void => {
  const row = db.query<{ user_version: number }, []>('PRAGMA user_version').get()!
  if (row.user_version < SCHEMA_VERSION) {
    db.run('PRAGMA foreign_keys = OFF')
    for (const table of DROP_ORDER) {
      db.run(`DROP TABLE IF EXISTS ${table}`)
    }
    db.run('PRAGMA foreign_keys = ON')
  }
  runStatements(db, schemaStatements)
  runStatements(db, ftsStatements)
  db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}
