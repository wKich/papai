import { z } from 'zod'

// Import task item schema
export const ImportTaskItemSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  status: z.string(),
  priority: z.string().optional(),
  dueDate: z.string().optional(),
  userId: z.string().nullable().optional(),
})

// Path parameters
export const ImportTasksPathSchema = z.object({
  projectId: z.string(),
})

// Request body schema
export const ImportTasksBodySchema = z.object({
  tasks: z.array(ImportTaskItemSchema),
})

// Request schema
export const ImportTasksRequestSchema = z.object({
  path: ImportTasksPathSchema,
  body: ImportTasksBodySchema,
})

// Response schema (generic object)
export const ImportTasksResponseSchema = z.record(z.string(), z.unknown())

// TypeScript types
export type ImportTaskItem = z.infer<typeof ImportTaskItemSchema>
export type ImportTasksPath = z.infer<typeof ImportTasksPathSchema>
export type ImportTasksBody = z.infer<typeof ImportTasksBodySchema>
export type ImportTasksRequest = z.infer<typeof ImportTasksRequestSchema>
export type ImportTasksResponse = z.infer<typeof ImportTasksResponseSchema>
