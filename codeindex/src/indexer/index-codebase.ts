import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { CodeindexConfig } from '../config.js'
import { buildModuleIdentity, type ModuleAlias } from '../resolver/module-specifiers.js'
import { resolveReferenceCandidates } from '../resolver/resolve-references.js'
import {
  expandTsconfigAliasesForFile,
  loadTsconfigPathAliases,
  type TsconfigAliasRule,
} from '../resolver/tsconfig-paths.js'
import { openDatabase } from '../storage/db.js'
import {
  clearFileRows,
  findDependentsOfDeletedFiles,
  insertFile,
  markParseFailure,
  persistAliases,
  persistModuleExports,
  persistSymbols,
  pruneDeletedFiles,
  selectAllFiles,
  selectAllModuleAliases,
  selectAllSymbols,
  selectStoredSymbols,
} from '../storage/queries.js'
import { ensureSchema } from '../storage/schema.js'
import { discoverSourceFiles, type DiscoveredFile } from './discover.js'
import { extractReferenceCandidates, type ExtractReferenceCandidatesResult } from './extract-references.js'
import { extractSymbolsFromSource, type ExtractedSymbol } from './extract-symbols.js'
import { createParserLoader, type ParserLoader } from './parser.js'

export interface IndexSummary {
  readonly filesIndexed: number
  readonly filesFailed: number
  readonly filesPruned: number
  readonly symbolsIndexed: number
  readonly referencesIndexed: number
  readonly referencesUnresolved: number
  readonly elapsedMs: number
}

export interface IndexCodebaseInput {
  readonly config: CodeindexConfig
  readonly mode: 'full' | 'incremental'
}

interface ParsedFileWorkItem {
  readonly fileId: number
  readonly moduleKey: string
  readonly referenceCandidates: ExtractReferenceCandidatesResult
}

interface ProcessedFileSuccess {
  readonly status: 'ok'
  readonly aliases: readonly ModuleAlias[]
  readonly file: DiscoveredFile
  readonly fileHash: string
  readonly language: string
  readonly moduleKey: string
  readonly referenceCandidates: ExtractReferenceCandidatesResult
  readonly symbols: readonly ExtractedSymbol[]
}

interface ProcessedFileFailure {
  readonly status: 'error'
  readonly file: DiscoveredFile
  readonly message: string
}

type ProcessedFile = ProcessedFileSuccess | ProcessedFileFailure

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

const parseFile = async (
  config: CodeindexConfig,
  file: DiscoveredFile,
  parserLoader: ParserLoader,
  tsconfigAliases: readonly TsconfigAliasRule[],
): Promise<ProcessedFile> => {
  try {
    const source = await readFile(file.absolutePath, 'utf8')
    const fileHash = sha256(source)
    const { moduleKey, aliases } = buildModuleIdentity(file.relativePath)
    const parsed = await parserLoader.createParserForExtension(file.extension)
    const tree = parsed.parser.parse(source)
    if (tree === null) {
      throw new Error(`Failed to parse ${file.relativePath}`)
    }

    return {
      status: 'ok',
      aliases: [...aliases, ...expandTsconfigAliasesForFile(file.absolutePath, tsconfigAliases)],
      file,
      fileHash,
      language: parsed.language,
      moduleKey,
      referenceCandidates: extractReferenceCandidates({
        source,
        tree,
        relativeFilePath: file.relativePath,
        moduleKey,
      }),
      symbols: extractSymbolsFromSource({
        source,
        tree,
        relativeFilePath: file.relativePath,
        moduleKey,
        maxStoredBodyLines: config.maxStoredBodyLines,
        includeDocComments: config.includeDocComments,
        indexLocals: config.indexLocals,
        indexVariables: config.indexVariables,
      }),
    }
  } catch (error) {
    return {
      status: 'error',
      file,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

const persistProcessedFile = (db: Database, processedFile: ProcessedFileSuccess): ParsedFileWorkItem => {
  const fileId = insertFile(db, {
    filePath: processedFile.file.relativePath,
    moduleKey: processedFile.moduleKey,
    language: processedFile.language,
    fileHash: processedFile.fileHash,
  })

  clearFileRows(db, fileId)
  persistAliases(db, fileId, processedFile.aliases)
  persistSymbols(db, fileId, processedFile.file.relativePath, processedFile.moduleKey, processedFile.symbols)
  persistModuleExports(db, fileId, processedFile.referenceCandidates, selectStoredSymbols(db, fileId))

  return {
    fileId,
    moduleKey: processedFile.moduleKey,
    referenceCandidates: processedFile.referenceCandidates,
  }
}

const findIncrementalFileSet = async (db: Database, files: readonly DiscoveredFile[]): Promise<ReadonlySet<string>> => {
  const fileHashes = await Promise.all(
    files.map(async (file) => ({
      file,
      fileHash: sha256(await readFile(file.absolutePath, 'utf8')),
    })),
  )

  const changedFiles = fileHashes
    .filter(({ file, fileHash }) => {
      const existing = db
        .query<{ file_hash: string }, [string]>('SELECT file_hash FROM files WHERE file_path = ?')
        .get(file.relativePath)
      return existing === null || existing.file_hash !== fileHash
    })
    .map(({ file }) => file.relativePath)

  const dependentFiles = changedFiles.flatMap((changedFilePath) =>
    db
      .query<{ file_path: string }, [string]>(
        `SELECT DISTINCT source_files.file_path
         FROM symbol_references
         JOIN files AS source_files ON source_files.id = symbol_references.source_file_id
         JOIN files AS target_files ON target_files.file_path = ?
         LEFT JOIN symbols AS target_symbols ON target_symbols.id = symbol_references.target_symbol_id
         WHERE target_symbols.file_id = target_files.id
            OR symbol_references.target_file_id = target_files.id`,
      )
      .all(changedFilePath)
      .map((row) => row.file_path),
  )

  return new Set([...changedFiles, ...dependentFiles])
}

const applyProcessedFiles = (
  db: Database,
  processedFiles: readonly ProcessedFile[],
): Readonly<{
  filesIndexed: number
  filesFailed: number
  symbolsIndexed: number
  parsedFiles: ParsedFileWorkItem[]
}> => {
  let filesIndexed = 0
  let filesFailed = 0
  let symbolsIndexed = 0
  const parsedFiles: ParsedFileWorkItem[] = []

  for (const processedFile of processedFiles) {
    if (processedFile.status === 'error') {
      filesFailed += 1
      markParseFailure(db, processedFile.file, processedFile.message)
      continue
    }

    parsedFiles.push(persistProcessedFile(db, processedFile))
    filesIndexed += 1
    symbolsIndexed += processedFile.symbols.length
  }

  return { filesIndexed, filesFailed, symbolsIndexed, parsedFiles }
}

const persistResolvedReferences = (
  db: Database,
  parsedFiles: readonly ParsedFileWorkItem[],
): Readonly<{ referencesIndexed: number; referencesUnresolved: number }> => {
  const allSymbols = selectAllSymbols(db)
  const allFiles = selectAllFiles(db)
  const allModuleAliases = selectAllModuleAliases(db)
  let referencesIndexed = 0
  let referencesUnresolved = 0

  for (const parsedFile of parsedFiles) {
    const resolvedReferences = resolveReferenceCandidates({
      symbols: allSymbols,
      moduleAliases: allModuleAliases,
      files: allFiles,
      references: parsedFile.referenceCandidates.references,
      currentModuleKey: parsedFile.moduleKey,
    })

    for (const reference of resolvedReferences) {
      db.query(
        'INSERT INTO symbol_references (source_symbol_id, source_file_id, target_symbol_id, target_file_id, target_name, target_export_name, target_module_specifier, edge_type, confidence, line_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        reference.sourceSymbolId,
        parsedFile.fileId,
        reference.targetSymbolId,
        reference.targetFileId,
        reference.targetName,
        reference.targetExportName,
        reference.targetModuleSpecifier,
        reference.edgeType,
        reference.confidence,
        reference.lineNumber,
      )
      referencesIndexed += 1
      if (reference.targetSymbolId === null) {
        referencesUnresolved += 1
      }
    }
  }

  return { referencesIndexed, referencesUnresolved }
}

export const indexCodebase = async (input: Readonly<IndexCodebaseInput>): Promise<IndexSummary> => {
  const startedAt = Date.now()
  const db = openDatabase(input.config.dbPath)
  ensureSchema(db)

  const parserLoader = await createParserLoader()
  const tsconfigAliases = loadTsconfigPathAliases(input.config.tsconfigPaths)
  const discoveredFiles = await discoverSourceFiles({
    repoRoot: input.config.repoRoot,
    roots: input.config.roots,
    exclude: input.config.exclude,
    languages: input.config.languages,
  })
  const discoveredPathSet = new Set(discoveredFiles.map((f) => f.relativePath))
  const deletedFileDependents =
    input.mode === 'incremental' ? findDependentsOfDeletedFiles(db, discoveredPathSet) : null
  const filesPruned = pruneDeletedFiles(db, discoveredPathSet)
  const baseIncrementalSet = input.mode === 'incremental' ? await findIncrementalFileSet(db, discoveredFiles) : null
  const incrementalSet =
    baseIncrementalSet !== null && deletedFileDependents !== null
      ? new Set([...baseIncrementalSet, ...deletedFileDependents])
      : baseIncrementalSet
  const filesToProcess =
    incrementalSet === null ? discoveredFiles : discoveredFiles.filter((file) => incrementalSet.has(file.relativePath))
  const processedFiles = await Promise.all(
    filesToProcess.map((file) => parseFile(input.config, file, parserLoader, tsconfigAliases)),
  )

  const { filesIndexed, filesFailed, symbolsIndexed, parsedFiles } = applyProcessedFiles(db, processedFiles)
  const { referencesIndexed, referencesUnresolved } = persistResolvedReferences(db, parsedFiles)
  db.close()

  return {
    filesIndexed,
    filesFailed,
    filesPruned,
    symbolsIndexed,
    referencesIndexed,
    referencesUnresolved,
    elapsedMs: Date.now() - startedAt,
  }
}
