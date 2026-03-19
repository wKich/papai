import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { checkConfidence, confidenceField } from './confirmation-gate.js'

const log = logger.child({ scope: 'tool:remove-label' })

export function makeRemoveLabelTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Remove (delete) a Kaneo label.',
    inputSchema: z.object({
      labelId: z.string().describe('Kaneo label ID to remove'),
      label: z.string().optional().describe('Human-readable label name for the confirmation message (e.g. "urgent")'),
      confidence: confidenceField,
    }),
    execute: async ({ labelId, label, confidence }) => {
      log.debug({ labelId, confidence }, 'remove_label called')
      const gate = checkConfidence(confidence, `Remove label "${label ?? labelId}"`)
      if (gate !== null) {
        log.warn({ labelId, confidence }, 'remove_label blocked — confirmation required')
        return gate
      }
      try {
        return await provider.removeLabel!(labelId)
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), labelId, tool: 'remove_label' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
