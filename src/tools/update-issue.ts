import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { updateIssue } from '../linear/index.js'
import { logger } from '../logger.js'

export function makeUpdateIssueTool(linearKey: string): ToolSet[string] {
  return tool({
    description:
      "Update an existing Linear issue status or assignee. Use this when the user wants to change a task's state or reassign it.",
    inputSchema: z.object({
      issueId: z.string().describe("The Linear issue ID (e.g. 'abc123')"),
      status: z.string().optional().describe("New workflow state name (e.g. 'In Progress', 'Done', 'Todo')"),
      assigneeId: z.string().optional().describe('Linear user ID to assign the issue to'),
      dueDate: z.string().optional().describe("Due date in ISO 8601 format (e.g. '2026-03-15')"),
      labelIds: z.string().array().optional().describe('Label IDs to apply. Call list_labels first to get IDs.'),
      estimate: z.number().int().optional().describe('Story point estimate'),
    }),
    execute: async ({ issueId, status, assigneeId, dueDate, labelIds, estimate }) => {
      try {
        const issue = await updateIssue({ apiKey: linearKey, issueId, status, assigneeId, dueDate, labelIds, estimate })
        if (!issue) {
          logger.warn({ issueId, status, assigneeId }, 'updateIssue returned no issue')
        } else if (!issue.id || !issue.identifier) {
          logger.warn({ issue }, 'updateIssue returned incomplete issue data')
        }
        return { id: issue?.id, identifier: issue?.identifier, title: issue?.title, url: issue?.url }
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error), issueId, tool: 'update_issue' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
