import { z } from 'zod'

import { KaneoTaskListItemSchema } from './list-tasks.js'

// Schema matching the actual GET /task/tasks/:projectId response, which nests
// tasks inside columns rather than returning a flat array.
export const GetTasksTaskSchema = KaneoTaskListItemSchema.extend({
  description: z.string().optional(),
  position: z.number().optional(),
  createdAt: z.string().or(z.date()).optional(),
  userId: z.string().nullable().optional(),
  projectId: z.string().optional(),
  labels: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })).optional(),
  externalLinks: z.array(z.unknown()).optional(),
})

export const GetTasksResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  columns: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      isFinal: z.boolean(),
      tasks: z.array(GetTasksTaskSchema),
    }),
  ),
  archivedTasks: z.array(GetTasksTaskSchema),
  plannedTasks: z.array(GetTasksTaskSchema),
})
