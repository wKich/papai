import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { checkConfidence, confidenceField } from './confirmation-gate.js'

const log = logger.child({ scope: 'tool:delete-status' })

export function makeDeleteStatusTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Delete a status from a project.',
    inputSchema: z.object({
      statusId: z.string().describe('Status ID to delete'),
      label: z
        .string()
        .optional()
        .describe('Human-readable status name for the confirmation message (e.g. "In Progress")'),
      confidence: confidenceField,
    }),
    execute: async ({ statusId, label, confidence }) => {
      log.debug({ statusId, confidence }, 'delete_status called')
      const gate = checkConfidence(confidence, `Delete status "${label ?? statusId}"`)
      if (gate !== null) {
        log.warn({ statusId, confidence }, 'delete_status blocked — confirmation required')
        return gate
      }
      try {
        return await provider.deleteStatus!(statusId)
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), statusId, tool: 'delete_status' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
