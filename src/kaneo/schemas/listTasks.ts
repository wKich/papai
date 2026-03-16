import { z } from 'zod'

// Column schema
const ColumnSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  isFinal: z.boolean(),
})

// Task within columns (simplified)
const ListTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  number: z.number(),
  status: z.string(),
  priority: z.string(),
  description: z.string().optional(),
  position: z.number().optional(),
  createdAt: z.string().or(z.date()).optional(),
  userId: z.string().nullable().optional(),
  projectId: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  labels: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })).optional(),
  externalLinks: z.array(z.unknown()).optional(),
})

// Column with tasks
const ColumnWithTasksSchema = ColumnSchema.extend({
  tasks: z.array(ListTaskSchema),
})

// Path parameters
export const ListTasksPathSchema = z.object({
  projectId: z.string(),
})

// Request schema (no body)
export const ListTasksRequestSchema = z.object({
  path: ListTasksPathSchema,
})

// Response schema
export const ListTasksResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  columns: z.array(ColumnWithTasksSchema),
  archivedTasks: z.array(ListTaskSchema),
  plannedTasks: z.array(ListTaskSchema),
})

// Export schemas for reuse (including internals needed by api-compat.ts)
export { ColumnSchema, ColumnWithTasksSchema, ListTaskSchema }

// TypeScript types
export type ListTasksPath = z.infer<typeof ListTasksPathSchema>
export type ListTasksRequest = z.infer<typeof ListTasksRequestSchema>
export type ListTasksResponse = z.infer<typeof ListTasksResponseSchema>
export type Column = z.infer<typeof ColumnSchema>
