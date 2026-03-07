import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { updateIssue } from '../huly/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:update-issue' })

export function makeUpdateIssueTool(userId: number): ToolSet[string] {
  return tool({
    description:
      "Update an existing issue status, assignee, due date, labels, estimate, or project. Use this when the user wants to change a task's properties.",
    inputSchema: z.object({
      issueId: z.string().describe("The issue ID (e.g. 'abc123')"),
      status: z.string().optional().describe("New workflow state name (e.g. 'In Progress', 'Done', 'Todo')"),
      assigneeId: z.string().optional().describe('User ID to assign the issue to'),
      dueDate: z.string().optional().describe("Due date in ISO 8601 format (e.g. '2026-03-15')"),
      labelIds: z.string().array().optional().describe('Label IDs to apply. Call list_labels first to get IDs.'),
      estimate: z.number().int().optional().describe('Story point estimate'),
      projectId: z.string().describe('Project ID to move the issue to'),
    }),
    execute: async ({ issueId, status, assigneeId, dueDate, labelIds, estimate, projectId }) => {
      try {
        const issue = await updateIssue({
          userId,
          issueId,
          status,
          assigneeId,
          dueDate,
          labelIds,
          estimate,
          projectId,
        })
        if (issue === undefined) {
          log.warn({ issueId, status, assigneeId, projectId }, 'updateIssue returned no issue')
        } else if (issue.id === undefined || issue.identifier === undefined) {
          log.warn({ issue }, 'updateIssue returned incomplete issue data')
        }
        return {
          id: issue?.id ?? '',
          identifier: issue?.identifier ?? '',
        }
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), issueId, tool: 'update_issue' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
