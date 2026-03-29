import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { executeList, type ListInput } from '../deferred-prompts/tool-handlers.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:list-deferred-prompts' })

export function makeListDeferredPromptsTool(userId: string): ToolSet[string] {
  return tool({
    description: 'List deferred prompts (scheduled tasks and monitoring alerts). Optionally filter by type or status.',
    inputSchema: z.object({
      type: z.enum(['scheduled', 'alert']).optional().describe('Filter by prompt type'),
      status: z.enum(['active', 'completed', 'cancelled']).optional().describe('Filter by status'),
    }),
    execute: (input: ListInput) => {
      try {
        return executeList(userId, input)
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'list_deferred_prompts' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
