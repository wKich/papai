import path from 'node:path'

type SymbolSummary = {
  readonly id: number
  readonly qualifiedName: string
  readonly localName: string
  readonly moduleKey: string
  readonly exportNames: readonly string[]
}

type ModuleAliasSummary = {
  readonly aliasKey: string
  readonly fileId: number
}

type FileSummary = {
  readonly id: number
  readonly moduleKey: string
}

type ReferenceCandidate = {
  readonly sourceQualifiedName: string | null
  readonly edgeType: 'imports' | 'reexports' | 'calls' | 'extends' | 'implements' | 'references'
  readonly targetName: string
  readonly targetExportName: string | null
  readonly targetModuleSpecifier: string | null
  readonly lineNumber: number
}

export interface ResolveReferenceCandidatesInput {
  readonly symbols: readonly SymbolSummary[]
  readonly moduleAliases: readonly ModuleAliasSummary[]
  readonly files: readonly FileSummary[]
  readonly references: readonly ReferenceCandidate[]
  readonly currentModuleKey: string
}

export interface ResolvedReference {
  readonly sourceSymbolId: number | null
  readonly sourceQualifiedName: string | null
  readonly edgeType: ReferenceCandidate['edgeType']
  readonly targetName: string
  readonly targetExportName: string | null
  readonly targetModuleSpecifier: string | null
  readonly targetSymbolId: number | null
  readonly targetFileId: number | null
  readonly confidence: 'resolved' | 'file_resolved' | 'name_only'
  readonly lineNumber: number
}

const normalizeRelativeModule = (fromModuleKey: string, specifier: string): string => {
  if (!specifier.startsWith('.')) {
    return specifier
  }
  const parentDir = path.posix.dirname(fromModuleKey)
  return path.posix.normalize(path.posix.join(parentDir, specifier)).replace(/\.[^.]+$/, '')
}

const findMatchedFileId = (
  input: Readonly<ResolveReferenceCandidatesInput>,
  targetModuleSpecifier: string | null,
): number | null => {
  if (targetModuleSpecifier === null) {
    return null
  }
  const normalizedSpecifier = normalizeRelativeModule(input.currentModuleKey, targetModuleSpecifier)
  return (
    input.moduleAliases.find((alias) => alias.aliasKey === normalizedSpecifier)?.fileId ??
    input.files.find((file) => file.moduleKey === normalizedSpecifier)?.id ??
    null
  )
}

const findResolvedSymbol = (
  input: Readonly<ResolveReferenceCandidatesInput>,
  matchedFileId: number | null,
  reference: Readonly<ReferenceCandidate>,
  importMap: ReadonlyMap<string, number>,
): Readonly<{ targetSymbolId: number | null; confidence: ResolvedReference['confidence'] }> => {
  const resolvedFromImport = matchedFileId === null ? importMap.get(reference.targetName) : undefined
  if (resolvedFromImport !== undefined) {
    return { targetSymbolId: resolvedFromImport, confidence: 'resolved' }
  }

  const resolvedByExport =
    matchedFileId === null
      ? undefined
      : input.symbols.find(
          (symbol) =>
            symbol.exportNames.includes(reference.targetExportName ?? reference.targetName) &&
            input.files.find((file) => file.id === matchedFileId)?.moduleKey === symbol.moduleKey,
        )
  if (resolvedByExport !== undefined) {
    return { targetSymbolId: resolvedByExport.id, confidence: 'resolved' }
  }

  const matchedModuleKey =
    matchedFileId === null ? null : (input.files.find((file) => file.id === matchedFileId)?.moduleKey ?? null)
  const resolvedByName = input.symbols.find(
    (symbol) =>
      symbol.localName === reference.targetName && (matchedModuleKey === null || symbol.moduleKey === matchedModuleKey),
  )
  if (resolvedByName !== undefined) {
    return {
      targetSymbolId: resolvedByName.id,
      confidence: matchedFileId === null ? 'name_only' : 'file_resolved',
    }
  }

  return {
    targetSymbolId: null,
    confidence: matchedFileId === null ? 'name_only' : 'file_resolved',
  }
}

export const resolveReferenceCandidates = (
  input: Readonly<ResolveReferenceCandidatesInput>,
): readonly ResolvedReference[] => {
  const sourceSymbols = new Map(input.symbols.map((symbol) => [symbol.qualifiedName, symbol.id]))
  const importMap = new Map<string, number>()

  return input.references.map((reference) => {
    const matchedFileId = findMatchedFileId(input, reference.targetModuleSpecifier)
    const { targetSymbolId, confidence } = findResolvedSymbol(input, matchedFileId, reference, importMap)

    if (reference.edgeType === 'imports' && targetSymbolId !== null) {
      importMap.set(reference.targetName, targetSymbolId)
    }

    return {
      sourceSymbolId:
        reference.sourceQualifiedName === null ? null : (sourceSymbols.get(reference.sourceQualifiedName) ?? null),
      ...reference,
      targetSymbolId,
      targetFileId: matchedFileId,
      confidence,
    }
  })
}
