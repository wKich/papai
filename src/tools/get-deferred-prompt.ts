import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { executeGet } from '../deferred-prompts/tool-handlers.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:get-deferred-prompt' })

export function makeGetDeferredPromptTool(userId: string): ToolSet[string] {
  return tool({
    description: 'Get full details of a deferred prompt by ID.',
    inputSchema: z.object({ id: z.string().describe('The deferred prompt ID') }),
    execute: (input: { id: string }) => {
      try {
        return executeGet(userId, input)
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'get_deferred_prompt' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
