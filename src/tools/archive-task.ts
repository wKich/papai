import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { checkConfidence, confidenceField } from './confirmation-gate.js'

const log = logger.child({ scope: 'tool:archive-task' })

export function makeArchiveTaskTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Archive a task. Use this to mark completed or stale tasks as archived.',
    inputSchema: z.object({
      taskId: z.string().describe('The task ID to archive'),
      label: z
        .string()
        .optional()
        .describe('Human-readable task title for the confirmation message (e.g. "Fix login bug")'),
      confidence: confidenceField,
    }),
    execute: async ({ taskId, label, confidence }) => {
      log.debug({ taskId, confidence }, 'archive_task called')
      const gate = checkConfidence(confidence, `Archive "${label ?? taskId}"`)
      if (gate !== null) {
        log.warn({ taskId, confidence }, 'archive_task blocked — confirmation required')
        return gate
      }
      try {
        return await provider.archiveTask!(taskId)
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, tool: 'archive_task' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
