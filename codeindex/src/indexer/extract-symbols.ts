import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'

import type { ScopeTier } from '../types.js'

export interface ExtractedSymbol {
  readonly symbolKey: string
  readonly localName: string
  readonly qualifiedName: string
  readonly kind: string
  readonly scopeTier: 'exported' | 'module' | 'member' | 'local'
  readonly exportNames: readonly string[]
  readonly signatureText: string
  readonly docText: string
  readonly bodyText: string
  readonly identifierTerms: string
  readonly startLine: number
  readonly endLine: number
  readonly startByte: number
  readonly endByte: number
  readonly parentQualifiedName: string | null
}

export interface ExtractSymbolsInput {
  readonly source: string
  readonly tree: Tree
  readonly relativeFilePath: string
  readonly moduleKey: string
  readonly maxStoredBodyLines: number
  readonly includeDocComments: boolean
  readonly indexLocals: boolean
  readonly indexVariables: boolean
}

interface WalkContext {
  readonly exported: boolean
  readonly isDefaultExport: boolean
  readonly parentQualifiedName: string | null
}

const declarationTypes = new Set([
  'abstract_class_declaration',
  'class_declaration',
  'enum_declaration',
  'function_declaration',
  'interface_declaration',
  'lexical_declaration',
  'method_definition',
  'public_field_definition',
  'type_alias_declaration',
  'variable_declarator',
])

const memberTypes = new Set(['method_definition', 'public_field_definition'])

const normalizeIdentifierTerms = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim()

const sliceNodeText = (source: string, node: SyntaxNode): string => source.slice(node.startIndex, node.endIndex)

const clipBody = (body: string, maxLines: number): string => body.split('\n').slice(0, maxLines).join('\n')

const readLeadingDocComment = (sourceLines: readonly string[], startLine: number): string => {
  const collected: string[] = []

  for (let line = startLine - 1; line >= 0; line -= 1) {
    const current = sourceLines[line]?.trim() ?? ''
    if (current === '') {
      break
    }
    collected.unshift(current)
    if (current.startsWith('/**')) {
      return collected.join('\n')
    }
    if (!current.startsWith('*') && !current.endsWith('*/')) {
      break
    }
  }

  return ''
}

const nameForNode = (node: SyntaxNode): string | null =>
  node.type === 'lexical_declaration' ? null : (node.childForFieldName('name')?.text ?? null)

const scopeTierForNode = (node: SyntaxNode, context: Readonly<WalkContext>): ScopeTier => {
  if (context.exported) {
    return 'exported'
  }
  if (memberTypes.has(node.type)) {
    return 'member'
  }
  return context.parentQualifiedName === null ? 'module' : 'local'
}

const visitChildren = (
  node: SyntaxNode,
  context: Readonly<WalkContext>,
  visit: (child: SyntaxNode, childContext: Readonly<WalkContext>) => void,
): void => {
  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index)
    if (child !== null) {
      visit(child, context)
    }
  }
}

const buildSymbol = (
  node: SyntaxNode,
  input: Readonly<ExtractSymbolsInput>,
  context: Readonly<WalkContext>,
  sourceLines: readonly string[],
  qualifiedName: string,
  localName: string,
): ExtractedSymbol => ({
  symbolKey: `${input.relativeFilePath}#${node.startIndex}-${node.endIndex}`,
  localName,
  qualifiedName,
  kind: node.type,
  scopeTier: scopeTierForNode(node, context),
  exportNames: context.exported ? (context.isDefaultExport ? ['default'] : [localName]) : [],
  signatureText: sourceLines[node.startPosition.row]?.trim() ?? localName,
  docText: input.includeDocComments ? readLeadingDocComment(sourceLines, node.startPosition.row) : '',
  bodyText: clipBody(sliceNodeText(input.source, node), input.maxStoredBodyLines),
  identifierTerms: normalizeIdentifierTerms(localName),
  startLine: node.startPosition.row + 1,
  endLine: node.endPosition.row + 1,
  startByte: node.startIndex,
  endByte: node.endIndex,
  parentQualifiedName: context.parentQualifiedName,
})

const qualifiedNameFor = (moduleKey: string, context: Readonly<WalkContext>, localName: string): string =>
  context.parentQualifiedName === null ? `${moduleKey}#${localName}` : `${context.parentQualifiedName}>${localName}`

export const extractSymbolsFromSource = (input: Readonly<ExtractSymbolsInput>): readonly ExtractedSymbol[] => {
  const symbols: ExtractedSymbol[] = []
  const sourceLines = input.source.split('\n')

  const visit = (node: SyntaxNode, context: Readonly<WalkContext>): void => {
    if (node.type === 'export_statement') {
      let isDefaultExport = false
      for (let i = 0; i < node.childCount; i += 1) {
        if (node.child(i)?.type === 'default') {
          isDefaultExport = true
          break
        }
      }
      visitChildren(node, { ...context, exported: true, isDefaultExport }, visit)
      return
    }

    const rawName = declarationTypes.has(node.type) ? nameForNode(node) : null
    const localName = rawName === null && context.isDefaultExport ? 'default' : rawName
    if (localName === null) {
      visitChildren(node, context, visit)
      return
    }

    const qualifiedName = qualifiedNameFor(input.moduleKey, context, localName)
    symbols.push(buildSymbol(node, input, context, sourceLines, qualifiedName, localName))
    visitChildren(node, { exported: false, isDefaultExport: false, parentQualifiedName: qualifiedName }, visit)
  }

  visit(input.tree.rootNode, { exported: false, isDefaultExport: false, parentQualifiedName: null })
  return symbols.filter(
    (symbol) =>
      symbol.kind !== 'program' &&
      (input.indexLocals || symbol.scopeTier !== 'local') &&
      (input.indexVariables || symbol.kind !== 'variable_declarator' || symbol.scopeTier === 'exported'),
  )
}
