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
  references: ReferenceCandidate[],
): void => {
  const localName = child.childForFieldName('name')?.text ?? null
  moduleExports.push({
    exportName: child.childForFieldName('alias')?.text ?? localName ?? child.text,
    exportKind: sourceSpecifier === null ? 'named' : 'reexport',
    localName,
    targetModuleSpecifier: sourceSpecifier,
  })
  if (sourceSpecifier !== null) {
    const targetName = localName ?? child.text
    references.push({
      sourceQualifiedName: null,
      edgeType: 'reexports',
      targetName,
      targetExportName: targetName,
      targetModuleSpecifier: sourceSpecifier,
      lineNumber: child.startPosition.row + 1,
    })
  }
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

const isNamedScopeBoundary = (node: SyntaxNode): boolean =>
  node.type === 'function_declaration' ||
  (node.type === 'function_expression' && node.parent?.type !== 'variable_declarator') ||
  node.type === 'class_declaration' ||
  node.type === 'abstract_class_declaration' ||
  node.type === 'method_definition' ||
  (node.type === 'variable_declarator' &&
    (node.childForFieldName('value')?.type === 'arrow_function' ||
      node.childForFieldName('value')?.type === 'function_expression'))

const hasDefaultKeyword = (node: SyntaxNode): boolean => {
  for (let i = 0; i < node.childCount; i += 1) {
    if (node.child(i)?.type === 'default') {
      return true
    }
  }
  return false
}

const pushNamedExportCandidate = (
  exportStatement: SyntaxNode,
  declarationNode: SyntaxNode,
  moduleExports: ModuleExportCandidate[],
): void => {
  const localName = declarationNode.childForFieldName('name')?.text
  const isDefault = hasDefaultKeyword(exportStatement)
  if (localName !== undefined) {
    moduleExports.push({
      exportName: isDefault ? 'default' : localName,
      exportKind: isDefault ? 'default' : 'named',
      localName,
      targetModuleSpecifier: null,
    })
  } else if (isDefault) {
    moduleExports.push({ exportName: 'default', exportKind: 'default', localName: null, targetModuleSpecifier: null })
  }
}

const pushLexicalExportCandidates = (
  exportStatement: SyntaxNode,
  lexicalDecl: SyntaxNode,
  moduleExports: ModuleExportCandidate[],
): void => {
  const isDefault = hasDefaultKeyword(exportStatement)
  for (let i = 0; i < lexicalDecl.namedChildCount; i += 1) {
    const declarator = lexicalDecl.namedChild(i)
    if (declarator?.type === 'variable_declarator') {
      const localName = declarator.childForFieldName('name')?.text
      if (localName !== undefined) {
        moduleExports.push({
          exportName: isDefault ? 'default' : localName,
          exportKind: isDefault ? 'default' : 'named',
          localName,
          targetModuleSpecifier: null,
        })
      }
    }
  }
}

const handleFunctionExportChild = (
  exportStatement: SyntaxNode,
  child: SyntaxNode,
  enclosingSymbol: string | null,
  moduleKey: string,
  moduleExports: ModuleExportCandidate[],
  visit: (node: SyntaxNode, enc: string | null) => void,
): void => {
  pushNamedExportCandidate(exportStatement, child, moduleExports)
  const isAnonymousDefault = child.childForFieldName('name') === null && hasDefaultKeyword(exportStatement)
  const newEnclosing = isAnonymousDefault
    ? enclosingSymbol === null
      ? `${moduleKey}#default`
      : `${enclosingSymbol}>default`
    : enclosingSymbol
  visit(child, newEnclosing)
}

const collectExportClauseSpecifiers = (
  clauseNode: SyntaxNode,
  sourceSpecifier: string | null,
  moduleExports: ModuleExportCandidate[],
  references: ReferenceCandidate[],
): void => {
  for (let i = 0; i < clauseNode.namedChildCount; i += 1) {
    const nestedChild = clauseNode.namedChild(i)
    if (nestedChild?.type === 'export_specifier') {
      pushExportSpecifier(nestedChild, sourceSpecifier, moduleExports, references)
    }
  }
}

const collectExportCandidates = (
  node: SyntaxNode,
  enclosingSymbol: string | null,
  moduleKey: string,
  moduleExports: ModuleExportCandidate[],
  references: ReferenceCandidate[],
  visit: (child: SyntaxNode, childEnclosingSymbol: string | null) => void,
): void => {
  const sourceSpecifier = normalizeSpecifier(node.childForFieldName('source'))

  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index)
    if (child === null) continue
    if (child.type === 'function_declaration' || child.type === 'function_expression') {
      handleFunctionExportChild(node, child, enclosingSymbol, moduleKey, moduleExports, visit)
      continue
    }
    if (child.type === 'class_declaration' || child.type === 'abstract_class_declaration' || child.type === 'class') {
      handleFunctionExportChild(node, child, enclosingSymbol, moduleKey, moduleExports, visit)
      continue
    }
    if (
      child.type === 'interface_declaration' ||
      child.type === 'type_alias_declaration' ||
      child.type === 'enum_declaration'
    ) {
      pushNamedExportCandidate(node, child, moduleExports)
      visit(child, enclosingSymbol)
      continue
    }
    if (child.type === 'lexical_declaration') {
      pushLexicalExportCandidates(node, child, moduleExports)
      visit(child, enclosingSymbol)
      continue
    }
    if (child.type === 'export_specifier') {
      pushExportSpecifier(child, sourceSpecifier, moduleExports, references)
      continue
    }
    if (child.type === 'export_clause') {
      collectExportClauseSpecifiers(child, sourceSpecifier, moduleExports, references)
      continue
    }
    visit(child, enclosingSymbol)
  }
}

const collectImportReference = (node: SyntaxNode, references: ReferenceCandidate[]): void => {
  const exportedName = node.childForFieldName('name')?.text ?? node.text
  const localName = node.childForFieldName('alias')?.text ?? exportedName
  const importStatement = node.parent?.parent?.parent
  references.push({
    sourceQualifiedName: null,
    edgeType: 'imports',
    targetName: localName,
    targetExportName: exportedName,
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
      collectExportCandidates(node, enclosingSymbol, input.moduleKey, moduleExports, references, visit)
      return
    }
    if (node.type === 'import_specifier') {
      collectImportReference(node, references)
    }
    if (node.type === 'identifier' && node.parent?.type === 'import_clause') {
      const importStatement = node.parent.parent
      references.push({
        sourceQualifiedName: null,
        edgeType: 'imports',
        targetName: node.text,
        targetExportName: 'default',
        targetModuleSpecifier: normalizeSpecifier(importStatement?.childForFieldName('source')),
        lineNumber: node.startPosition.row + 1,
      })
    }
    if (isNamedScopeBoundary(node)) {
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
