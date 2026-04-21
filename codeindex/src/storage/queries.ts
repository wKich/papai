import type { Database } from 'bun:sqlite'

import type { ExtractReferenceCandidatesResult } from '../indexer/extract-references.js'
import type { ExtractedSymbol } from '../indexer/extract-symbols.js'
import type { ModuleAlias } from '../resolver/module-specifiers.js'

export const parseStringArray = (value: string): readonly string[] => {
  const parsed: unknown = JSON.parse(value)
  return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string') ? parsed : []
}

export const clearFileRows = (db: Database, fileId: number): void => {
  db.query('DELETE FROM module_aliases WHERE file_id = ?').run(fileId)
  db.query('DELETE FROM module_exports WHERE file_id = ?').run(fileId)
  db.query('DELETE FROM symbol_references WHERE source_file_id = ?').run(fileId)
  db.query('DELETE FROM symbols WHERE file_id = ?').run(fileId)
}

export const pruneDeletedFiles = (db: Database, discoveredPaths: ReadonlySet<string>): number => {
  const storedPaths = db
    .query<{ file_path: string }, []>('SELECT file_path FROM files')
    .all()
    .map((row) => row.file_path)

  let pruned = 0
  for (const filePath of storedPaths) {
    if (!discoveredPaths.has(filePath)) {
      db.query('DELETE FROM files WHERE file_path = ?').run(filePath)
      pruned += 1
    }
  }
  return pruned
}

export const findDependentsOfDeletedFiles = (
  db: Database,
  discoveredPaths: ReadonlySet<string>,
): ReadonlySet<string> => {
  const storedPaths = db
    .query<{ file_path: string }, []>('SELECT file_path FROM files')
    .all()
    .map((row) => row.file_path)

  const dependents = new Set<string>()

  for (const filePath of storedPaths) {
    if (discoveredPaths.has(filePath)) continue

    const rows = db
      .query<{ file_path: string }, [string]>(
        `SELECT DISTINCT source_files.file_path
         FROM symbol_references
         JOIN files AS source_files ON source_files.id = symbol_references.source_file_id
         JOIN files AS target_files ON target_files.file_path = ?
         LEFT JOIN symbols AS target_symbols ON target_symbols.id = symbol_references.target_symbol_id
         WHERE target_symbols.file_id = target_files.id
            OR symbol_references.target_file_id = target_files.id`,
      )
      .all(filePath)

    for (const row of rows) {
      if (discoveredPaths.has(row.file_path)) {
        dependents.add(row.file_path)
      }
    }
  }

  return dependents
}

export const insertFile = (
  db: Database,
  values: Readonly<{ filePath: string; moduleKey: string; language: string; fileHash: string }>,
): number => {
  db.query(
    `INSERT INTO files (file_path, module_key, language, file_hash, parse_status, parse_error, indexed_at)
       VALUES (?, ?, ?, ?, 'indexed', NULL, datetime('now'))
       ON CONFLICT(file_path) DO UPDATE SET
         module_key = excluded.module_key,
         language = excluded.language,
         file_hash = excluded.file_hash,
         parse_status = 'indexed',
         parse_error = NULL,
         indexed_at = datetime('now')`,
  ).run(values.filePath, values.moduleKey, values.language, values.fileHash)

  const row = db.query<{ id: number }, [string]>('SELECT id FROM files WHERE file_path = ?').get(values.filePath)
  if (row === null) {
    throw new Error(`Missing file row for ${values.filePath}`)
  }
  return row.id
}

export const markParseFailure = (db: Database, file: Readonly<{ relativePath: string }>, message: string): void => {
  const existing = db.query<{ id: number }, [string]>('SELECT id FROM files WHERE file_path = ?').get(file.relativePath)
  if (existing !== null) {
    clearFileRows(db, existing.id)
  }
  db.query(
    `INSERT INTO files (file_path, module_key, language, file_hash, parse_status, parse_error, indexed_at)
       VALUES (?, ?, ?, '', 'parse_failed', ?, datetime('now'))
       ON CONFLICT(file_path) DO UPDATE SET parse_status = 'parse_failed', parse_error = excluded.parse_error, indexed_at = datetime('now')`,
  ).run(file.relativePath, file.relativePath.replace(/\.[^.]+$/, ''), 'ts', message)
}

export const persistAliases = (db: Database, fileId: number, aliases: readonly ModuleAlias[]): void => {
  for (const alias of aliases) {
    db.query('INSERT INTO module_aliases (file_id, alias_key, alias_kind, precedence) VALUES (?, ?, ?, ?)').run(
      fileId,
      alias.aliasKey,
      alias.aliasKind,
      alias.precedence,
    )
  }
}

export const persistSymbols = (
  db: Database,
  fileId: number,
  filePath: string,
  moduleKey: string,
  symbols: readonly ExtractedSymbol[],
): number => {
  let count = 0
  for (const symbol of symbols) {
    db.query(
      `INSERT INTO symbols (
          file_id, file_path, module_key, symbol_key, local_name, qualified_name, kind, scope_tier,
          parent_symbol_id, is_exported, export_names, signature_text, doc_text, body_text, identifier_terms,
          start_line, end_line, start_byte, end_byte
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      fileId,
      filePath,
      moduleKey,
      symbol.symbolKey,
      symbol.localName,
      symbol.qualifiedName,
      symbol.kind,
      symbol.scopeTier,
      symbol.scopeTier === 'exported' ? 1 : 0,
      JSON.stringify(symbol.exportNames),
      symbol.signatureText,
      symbol.docText,
      symbol.bodyText,
      symbol.identifierTerms,
      symbol.startLine,
      symbol.endLine,
      symbol.startByte,
      symbol.endByte,
    )
    count += 1
  }

  linkParentSymbols(db, fileId, symbols)
  return count
}

const linkParentSymbols = (db: Database, fileId: number, symbols: readonly ExtractedSymbol[]): void => {
  const stmt = db.query<never, [string, number, string]>(
    `UPDATE symbols SET parent_symbol_id = (
       SELECT id FROM symbols WHERE qualified_name = ? AND file_id = ?
     ) WHERE symbol_key = ?`,
  )
  for (const symbol of symbols) {
    if (symbol.parentQualifiedName !== null) {
      stmt.run(symbol.parentQualifiedName, fileId, symbol.symbolKey)
    }
  }
}

export const selectStoredSymbols = (
  db: Database,
  fileId: number,
): readonly {
  id: number
  qualifiedName: string
  localName: string
  moduleKey: string
  exportNames: readonly string[]
}[] =>
  db
    .query<
      { id: number; qualified_name: string; local_name: string; module_key: string; export_names: string },
      [number]
    >('SELECT id, qualified_name, local_name, module_key, export_names FROM symbols WHERE file_id = ?')
    .all(fileId)
    .map((row) => ({
      id: row.id,
      qualifiedName: row.qualified_name,
      localName: row.local_name,
      moduleKey: row.module_key,
      exportNames: parseStringArray(row.export_names),
    }))

export const persistModuleExports = (
  db: Database,
  fileId: number,
  referenceCandidates: ExtractReferenceCandidatesResult,
  storedSymbols: ReturnType<typeof selectStoredSymbols>,
): void => {
  for (const moduleExport of referenceCandidates.moduleExports) {
    const matchingSymbol = storedSymbols.find((symbol) => symbol.localName === moduleExport.localName)
    db.query(
      'INSERT INTO module_exports (file_id, export_name, export_kind, symbol_id, target_module_specifier, resolved_file_id) VALUES (?, ?, ?, ?, ?, NULL)',
    ).run(
      fileId,
      moduleExport.exportName,
      moduleExport.exportKind,
      matchingSymbol?.id ?? null,
      moduleExport.targetModuleSpecifier,
    )
  }
}

export const selectAllSymbols = (
  db: Database,
): readonly {
  id: number
  qualifiedName: string
  localName: string
  moduleKey: string
  exportNames: readonly string[]
}[] =>
  db
    .query<{ id: number; qualified_name: string; local_name: string; module_key: string; export_names: string }, []>(
      'SELECT id, qualified_name, local_name, module_key, export_names FROM symbols',
    )
    .all()
    .map((row) => ({
      id: row.id,
      qualifiedName: row.qualified_name,
      localName: row.local_name,
      moduleKey: row.module_key,
      exportNames: parseStringArray(row.export_names),
    }))

export const selectAllFiles = (db: Database): readonly { id: number; moduleKey: string }[] =>
  db
    .query<{ id: number; module_key: string }, [string]>('SELECT id, module_key FROM files WHERE parse_status = ?')
    .all('indexed')
    .map((row) => ({ id: row.id, moduleKey: row.module_key }))

export const selectAllModuleAliases = (db: Database): readonly { aliasKey: string; fileId: number }[] =>
  db
    .query<{ alias_key: string; file_id: number }, []>('SELECT alias_key, file_id FROM module_aliases')
    .all()
    .map((row) => ({ aliasKey: row.alias_key, fileId: row.file_id }))
