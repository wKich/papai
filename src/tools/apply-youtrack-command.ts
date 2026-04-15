import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskCommandResult, TaskProvider } from '../providers/types.js'
import { checkConfidence, confidenceField } from './confirmation-gate.js'

const log = logger.child({ scope: 'tool:apply-youtrack-command' })

const NON_EMPTY_STRING = z.string().trim().min(1)
const SAFE_COMMAND_PATTERNS: readonly RegExp[] = [
  /^for\s+me$/i,
  /^for\s+\S+$/i,
  /^comment\s+.+$/i,
  /^tag\s+.+$/i,
  /^untag\s+.+$/i,
  /^vote$/i,
  /^unvote$/i,
  /^star$/i,
  /^unstar$/i,
]

const requiresConfirmation = (query: string): boolean => {
  const normalizedQuery = query.trim().replace(/\s+/g, ' ')
  return !SAFE_COMMAND_PATTERNS.some((pattern) => pattern.test(normalizedQuery))
}

export function makeApplyYouTrackCommandTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description:
      'Apply a YouTrack command to one or more issues. Use this only for YouTrack-native command workflows that do not fit the structured tools.',
    inputSchema: z.object({
      query: NON_EMPTY_STRING.describe(
        'The YouTrack command string to apply, for example "for me" or "State In Progress"',
      ),
      taskIds: z.array(NON_EMPTY_STRING).min(1).describe('One or more issue IDs such as TEST-1'),
      comment: z.string().optional().describe('Optional comment to add while applying the command'),
      silent: z.boolean().optional().describe('Whether to suppress notifications for this command when supported'),
      confidence: confidenceField.optional(),
    }),
    execute: async ({ query, taskIds, comment, silent, confidence }) => {
      const applyCommand = provider.applyCommand
      if (applyCommand === undefined) {
        throw new Error('YouTrack command support is unavailable')
      }

      if (requiresConfirmation(query)) {
        const gate = checkConfidence(
          confidence ?? 0,
          `Apply YouTrack command "${query.trim()}" to ${taskIds.length} issue(s)`,
        )
        if (gate !== null) {
          log.warn(
            { query, taskCount: taskIds.length, confidence },
            'apply_youtrack_command blocked — confirmation required',
          )
          return gate
        }
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
