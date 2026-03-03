import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { createIssue, updateIssue, searchIssues, listProjects } from './linear.js'
import { logger } from './logger.js'

type ToolConfig = {
  linearKey: string
  linearTeamId: string
}

function createIssueTool(linearKey: string, linearTeamId: string): ToolSet[string] {
  return tool({
    description: 'Create a new issue in Linear. Use this when the user wants to add a task or bug report.',
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
      projectId: z.string().optional().describe('Linear project ID to associate the issue with'),
    }),
    execute: async ({ title, description, priority, projectId }) => {
      try {
        const issue = await createIssue({
          apiKey: linearKey,
          title,
          description,
          priority,
          projectId,
          teamId: linearTeamId,
        })
        if (!issue) {
          logger.warn({ title, teamId: linearTeamId }, 'createIssue returned no issue')
        } else if (!issue.id || !issue.identifier) {
          logger.warn({ issue }, 'createIssue returned incomplete issue data')
        }
        return { id: issue?.id, identifier: issue?.identifier, title: issue?.title, url: issue?.url }
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            title,
            tool: 'create_issue',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}

function updateIssueTool(linearKey: string): ToolSet[string] {
  return tool({
    description:
      "Update an existing Linear issue status or assignee. Use this when the user wants to change a task's state or reassign it.",
    inputSchema: z.object({
      issueId: z.string().describe("The Linear issue ID (e.g. 'abc123')"),
      status: z.string().optional().describe("New workflow state name (e.g. 'In Progress', 'Done', 'Todo')"),
      assigneeId: z.string().optional().describe('Linear user ID to assign the issue to'),
    }),
    execute: async ({ issueId, status, assigneeId }) => {
      try {
        const issue = await updateIssue({ apiKey: linearKey, issueId, status, assigneeId })
        if (!issue) {
          logger.warn({ issueId, status, assigneeId }, 'updateIssue returned no issue')
        } else if (!issue.id || !issue.identifier) {
          logger.warn({ issue }, 'updateIssue returned incomplete issue data')
        }
        return { id: issue?.id, identifier: issue?.identifier, title: issue?.title, url: issue?.url }
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            issueId,
            tool: 'update_issue',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}

function searchIssuesTool(linearKey: string): ToolSet[string] {
  return tool({
    description:
      'Search for issues in Linear by keyword or filter by state. Use this when the user asks about existing tasks.',
    inputSchema: z.object({
      query: z.string().describe('Search keyword or phrase'),
      state: z.string().optional().describe("Filter by workflow state name (e.g. 'In Progress', 'Todo', 'Done')"),
    }),
    execute: ({ query, state }) => {
      try {
        return searchIssues({ apiKey: linearKey, query, state })
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            query,
            tool: 'search_issues',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}

function listProjectsTool(linearKey: string): ToolSet[string] {
  return tool({
    description:
      'List all available teams and projects in Linear. Call this to get projectId or teamId context before creating or searching issues.',
    inputSchema: z.object({}),
    execute: () => {
      try {
        return listProjects({ apiKey: linearKey })
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            tool: 'list_projects',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}

export function makeTools({ linearKey, linearTeamId }: ToolConfig): ToolSet {
  return {
    create_issue: createIssueTool(linearKey, linearTeamId),
    update_issue: updateIssueTool(linearKey),
    search_issues: searchIssuesTool(linearKey),
    list_projects: listProjectsTool(linearKey),
  }
}
