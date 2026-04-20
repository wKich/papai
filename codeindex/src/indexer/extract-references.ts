import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'

import type { ExportKind, ReferenceEdgeType } from '../types.js'

export interface ModuleExportCandidate {
  readonly exportName: string
  readonly exportKind: ExportKind
  readonly localName: string | null
  readonly targetModuleSpecifier: string | null
}

export interface ReferenceCandidate {
  readonly sourceQualifiedName: string | null
  readonly edgeType: ReferenceEdgeType
  readonly targetName: string
  readonly targetExportName: string | null
  readonly targetModuleSpecifier: string | null
  readonly lineNumber: number
}

export interface ExtractReferenceCandidatesInput {
  readonly source: string
  readonly tree: Tree
  readonly relativeFilePath: string
  readonly moduleKey: string
}

export interface ExtractReferenceCandidatesResult {
  readonly moduleExports: readonly ModuleExportCandidate[]
  readonly references: readonly ReferenceCandidate[]
}

const normalizeSpecifier = (node: SyntaxNode | null | undefined): string | null => {
  const text = node?.text
  if (text === undefined) {
    return null
  }
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
    return text.slice(1, -1)
  }
  return text
}

const pushExportSpecifier = (
  child: SyntaxNode,
  sourceSpecifier: string | null,
  moduleExports: ModuleExportCandidate[],
): void => {
  const localName = child.childForFieldName('name')?.text ?? null
  moduleExports.push({
    exportName: child.childForFieldName('alias')?.text ?? localName ?? child.text,
    exportKind: sourceSpecifier === null ? 'named' : 'reexport',
    localName,
    targetModuleSpecifier: sourceSpecifier,
  })
}

const visitChildren = (
  node: SyntaxNode,
  enclosingSymbol: string | null,
  visit: (child: SyntaxNode, childEnclosingSymbol: string | null) => void,
): void => {
  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index)
    if (child !== null) {
      visit(child, enclosingSymbol)
    }
  }
}

const nextEnclosingSymbol = (moduleKey: string, node: SyntaxNode, enclosingSymbol: string | null): string | null => {
  const functionName = node.childForFieldName('name')?.text
  if (functionName === undefined) {
    return enclosingSymbol
  }
  return enclosingSymbol === null ? `${moduleKey}#${functionName}` : `${enclosingSymbol}>${functionName}`
}

const collectExportCandidates = (
  node: SyntaxNode,
  enclosingSymbol: string | null,
  moduleExports: ModuleExportCandidate[],
  visit: (child: SyntaxNode, childEnclosingSymbol: string | null) => void,
): void => {
  const sourceSpecifier = normalizeSpecifier(node.childForFieldName('source'))

  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index)
    if (child === null) {
      continue
    }
    if (child.type === 'function_declaration') {
      const functionName = child.childForFieldName('name')?.text
      if (functionName !== undefined) {
        moduleExports.push({
          exportName: functionName,
          exportKind: 'named',
          localName: functionName,
          targetModuleSpecifier: null,
        })
      }
      visit(child, enclosingSymbol)
      continue
    }
    if (child.type === 'export_specifier') {
      pushExportSpecifier(child, sourceSpecifier, moduleExports)
      continue
    }
    if (child.type === 'export_clause') {
      for (let nestedIndex = 0; nestedIndex < child.namedChildCount; nestedIndex += 1) {
        const nestedChild = child.namedChild(nestedIndex)
        if (nestedChild?.type === 'export_specifier') {
          pushExportSpecifier(nestedChild, sourceSpecifier, moduleExports)
        }
      }
      continue
    }
    visit(child, enclosingSymbol)
  }
}

const collectImportReference = (node: SyntaxNode, references: ReferenceCandidate[]): void => {
  const imported = node.childForFieldName('name')?.text ?? node.text
  const importStatement = node.parent?.parent?.parent
  references.push({
    sourceQualifiedName: null,
    edgeType: 'imports',
    targetName: imported,
    targetExportName: imported,
    targetModuleSpecifier: normalizeSpecifier(importStatement?.childForFieldName('source')),
    lineNumber: node.startPosition.row + 1,
  })
}

const collectCallReference = (
  node: SyntaxNode,
  enclosingSymbol: string | null,
  references: ReferenceCandidate[],
): void => {
  const functionNode = node.childForFieldName('function')
  references.push({
    sourceQualifiedName: enclosingSymbol,
    edgeType: 'calls',
    targetName: functionNode?.text ?? node.text,
    targetExportName: null,
    targetModuleSpecifier: null,
    lineNumber: node.startPosition.row + 1,
  })
}

export const extractReferenceCandidates = (
  input: Readonly<ExtractReferenceCandidatesInput>,
): ExtractReferenceCandidatesResult => {
  const moduleExports: ModuleExportCandidate[] = []
  const references: ReferenceCandidate[] = []

  const visit = (node: SyntaxNode, enclosingSymbol: string | null): void => {
    if (node.type === 'export_statement') {
      collectExportCandidates(node, enclosingSymbol, moduleExports, visit)
      return
    }
    if (node.type === 'import_specifier') {
      collectImportReference(node, references)
    }
    if (node.type === 'function_declaration') {
      visitChildren(node, nextEnclosingSymbol(input.moduleKey, node, enclosingSymbol), visit)
      return
    }
    if (node.type === 'call_expression') {
      collectCallReference(node, enclosingSymbol, references)
    }
    visitChildren(node, enclosingSymbol, visit)
  }

  visit(input.tree.rootNode, null)
  return { moduleExports, references }
}
