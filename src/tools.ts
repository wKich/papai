import { tool } from "ai";
import { z } from "zod";
import { createIssue, updateIssue, searchIssues, listProjects } from "./linear.js";

export const tools = {
  create_issue: tool({
    description:
      "Create a new issue in Linear. Use this when the user wants to add a task or bug report.",
    inputSchema: z.object({
      title: z.string().describe("Short, descriptive issue title"),
      description: z.string().optional().describe("Detailed description of the issue"),
      priority: z
        .number()
        .int()
        .min(0)
        .max(4)
        .optional()
        .describe("Priority level: 0 = No priority, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low"),
      projectId: z.string().optional().describe("Linear project ID to associate the issue with"),
    }),
    execute: async ({ title, description, priority, projectId }) => {
      const teamId = process.env["LINEAR_TEAM_ID"]!;
      const issue = await createIssue({
        title,
        description,
        priority,
        projectId,
        teamId,
      });
      const resolved = issue;
      return {
        id: resolved?.id,
        identifier: resolved?.identifier,
        title: resolved?.title,
        url: resolved?.url,
      };
    },
  }),

  update_issue: tool({
    description:
      "Update an existing Linear issue status or assignee. Use this when the user wants to change a task's state or reassign it.",
    inputSchema: z.object({
      issueId: z.string().describe("The Linear issue ID (e.g. 'abc123')"),
      status: z
        .string()
        .optional()
        .describe("New workflow state name (e.g. 'In Progress', 'Done', 'Todo')"),
      assigneeId: z.string().optional().describe("Linear user ID to assign the issue to"),
    }),
    execute: async ({ issueId, status, assigneeId }) => {
      const issue = await updateIssue({ issueId, status, assigneeId });
      const resolved = issue;
      return {
        id: resolved?.id,
        identifier: resolved?.identifier,
        title: resolved?.title,
        url: resolved?.url,
      };
    },
  }),

  search_issues: tool({
    description:
      "Search for issues in Linear by keyword or filter by state. Use this when the user asks about existing tasks.",
    inputSchema: z.object({
      query: z.string().describe("Search keyword or phrase"),
      state: z
        .string()
        .optional()
        .describe("Filter by workflow state name (e.g. 'In Progress', 'Todo', 'Done')"),
    }),
    execute: async ({ query, state }) => {
      const issues = await searchIssues({ query, state });
      return issues;
    },
  }),

  list_projects: tool({
    description:
      "List all available teams and projects in Linear. Call this to get projectId or teamId context before creating or searching issues.",
    inputSchema: z.object({}),
    execute: async () => {
      const projects = await listProjects();
      return projects;
    },
  }),
};
