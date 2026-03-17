import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { checkConfidence, confidenceField } from './confirmation-gate.js'

const log = logger.child({ scope: 'tool:delete-column' })

export function makeDeleteColumnTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Delete a status column from a Kaneo project.',
    inputSchema: z.object({
      columnId: z.string().describe('Kaneo column ID to delete'),
      label: z
        .string()
        .optional()
        .describe('Human-readable column name for the confirmation message (e.g. "In Progress")'),
      confidence: confidenceField,
    }),
    execute: async ({ columnId, label, confidence }) => {
      log.debug({ columnId, confidence }, 'delete_column called')
      const gate = checkConfidence(confidence, `Delete column "${label ?? columnId}"`)
      if (gate !== null) {
        log.warn({ columnId, confidence }, 'delete_column blocked — confirmation required')
        return gate
      }
      try {
        return await provider.deleteColumn!(columnId)
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), columnId, tool: 'delete_column' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
