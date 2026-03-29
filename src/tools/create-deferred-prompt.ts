import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { executeCreate, type CreateInput } from '../deferred-prompts/tool-handlers.js'
import {
  alertConditionSchema,
  cooldownSchema,
  executionInputSchema,
  scheduleSchema,
} from '../deferred-prompts/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:create-deferred-prompt' })

export function makeCreateDeferredPromptTool(userId: string): ToolSet[string] {
  return tool({
    description:
      'Create a scheduled task or monitoring alert. Provide either a schedule (for time-based) or a condition (for event-based), not both. Always classify the execution mode based on what the prompt needs at fire time.',
    inputSchema: z.object({
      prompt: z.string().describe('What to do/say when this fires — not scheduling meta-instructions'),
      schedule: scheduleSchema.optional().describe('Time-based trigger (one-time or recurring)'),
      condition: alertConditionSchema.optional().describe('Event-based trigger condition'),
      cooldown_minutes: cooldownSchema,
      execution: executionInputSchema,
    }),
    execute: (input: CreateInput) => {
      try {
        return executeCreate(userId, input)
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'create_deferred_prompt' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
