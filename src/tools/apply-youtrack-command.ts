import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskCommandResult, TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:apply-youtrack-command' })

export function makeApplyYouTrackCommandTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description:
      'Apply a YouTrack command to one or more issues. Use this only for YouTrack-native command workflows that do not fit the structured tools.',
    inputSchema: z.object({
      query: z.string().describe('The YouTrack command string to apply, for example "for me" or "State In Progress"'),
      taskIds: z.array(z.string()).min(1).describe('One or more issue IDs such as TEST-1'),
      comment: z.string().optional().describe('Optional comment to add while applying the command'),
      silent: z.boolean().optional().describe('Whether to suppress notifications for this command when supported'),
    }),
    execute: async ({ query, taskIds, comment, silent }) => {
      const applyCommand = provider.applyCommand
      if (applyCommand === undefined) {
        throw new Error('YouTrack command support is unavailable')
      }

      try {
        const result: TaskCommandResult = await applyCommand({ query, taskIds, comment, silent })
        log.info({ query, taskCount: taskIds.length }, 'YouTrack command applied via tool')
        return result
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), query, tool: 'apply_youtrack_command' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
