import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getIssue } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:get-issue' })

export function makeGetIssueTool(linearKey: string): ToolSet[string] {
  return tool({
    description: 'Fetch full details of a single Linear issue.',
    inputSchema: z.object({ issueId: z.string().describe("Linear issue ID or identifier (e.g. 'PAP-42')") }),
    execute: async ({ issueId }) => {
      try {
        return await getIssue({ apiKey: linearKey, issueId })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), issueId, tool: 'get_issue' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
