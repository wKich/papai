import { z } from 'zod'

// Path parameters
export const ExportTasksPathSchema = z.object({
  projectId: z.string(),
})

// Request schema (no body)
export const ExportTasksRequestSchema = z.object({
  path: ExportTasksPathSchema,
})

// Response schema (generic object)
export const ExportTasksResponseSchema = z.record(z.string(), z.unknown())

// TypeScript types
export type ExportTasksPath = z.infer<typeof ExportTasksPathSchema>
export type ExportTasksRequest = z.infer<typeof ExportTasksRequestSchema>
export type ExportTasksResponse = z.infer<typeof ExportTasksResponseSchema>
