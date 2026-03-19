import { z } from 'zod'

// Column schema
export const ColumnSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  isFinal: z.boolean(),
})

// Task within columns (simplified)
export const ListTaskSchema = z.object({
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
