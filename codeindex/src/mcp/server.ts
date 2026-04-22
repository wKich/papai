import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import {
  type CodeImpactInput,
  CodeImpactInputSchema,
  type CodeIndexInput,
  CodeIndexInputSchema,
  type CodeSearchInput,
  CodeSearchInputSchema,
  type CodeSymbolInput,
  CodeSymbolInputSchema,
  type CodeindexToolDeps,
} from './tools.js'

export const createCodeindexServer = (deps: Readonly<CodeindexToolDeps>): McpServer => {
  const server = new McpServer({ name: 'codeindex', version: '0.1.0' })

  server.registerTool(
    'code_search',
    { description: 'Search indexed symbols', inputSchema: CodeSearchInputSchema },
    async ({ query, limit, kinds, scopeTiers, pathPrefix }: CodeSearchInput) => ({
      content: [
        { type: 'text', text: JSON.stringify(await deps.codeSearch({ query, limit, kinds, scopeTiers, pathPrefix })) },
      ],
    }),
  )

  server.registerTool(
    'code_symbol',
    { description: 'Resolve a query to candidate symbols', inputSchema: CodeSymbolInputSchema },
    async ({ query, limit }: CodeSymbolInput) => ({
      content: [{ type: 'text', text: JSON.stringify(await deps.codeSymbol(query, limit)) }],
    }),
  )

  server.registerTool(
    'code_impact',
    { description: 'Find incoming references for a symbol', inputSchema: CodeImpactInputSchema },
    async ({ symbolKey, qualifiedName, limit }: CodeImpactInput) => ({
      content: [{ type: 'text', text: JSON.stringify(await deps.codeImpact({ symbolKey, qualifiedName, limit })) }],
    }),
  )

  server.registerTool(
    'code_index',
    { description: 'Run full or incremental indexing', inputSchema: CodeIndexInputSchema },
    async ({ path, mode }: CodeIndexInput) => ({
      content: [{ type: 'text', text: JSON.stringify(await deps.codeIndex({ path, mode })) }],
    }),
  )

  return server
}
