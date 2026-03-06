import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { createIssue } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:create-issue' })

export function makeCreateIssueTool(userId: number): ToolSet[string] {
  return tool({
    description: 'Create a new issue. Use this when the user wants to add a task or bug report.',
    inputSchema: z.object({
      title: z.string().describe('Short, descriptive issue title'),
      description: z.string().optional().describe('Detailed description of the issue'),
      priority: z
        .number()
        .int()
        .min(0)
        .max(4)
        .optional()
        .describe('Priority level: 0 = No priority, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low'),
      projectId: z.string().optional().describe('Project ID to associate the issue with'),
      dueDate: z.string().optional().describe("Due date in ISO 8601 format (e.g. '2026-03-15')"),
      labelIds: z.string().array().optional().describe('Label IDs to apply. Call list_labels first to get IDs.'),
      estimate: z.number().int().optional().describe('Story point estimate'),
    }),
    execute: async ({ title, description, priority, projectId, dueDate, labelIds, estimate }) => {
      try {
        const issue = await createIssue({
          userId,
          title,
          description,
          priority,
          projectId,
          dueDate,
          labelIds,
          estimate,
        })
        if (!issue) {
          log.warn({ title, userId }, 'createIssue returned no issue')
        } else if (!issue.id || !issue.identifier) {
          log.warn({ issue }, 'createIssue returned incomplete issue data')
        }
        return { id: issue?.id, identifier: issue?.identifier, title: issue?.title, url: issue?.url }
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), title, tool: 'create_issue' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
