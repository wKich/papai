import { z } from 'zod'

const TaskPriorityEnum = z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])

// Task schema
export const SearchTaskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  position: z.number().nullable(),
  number: z.number().nullable(),
  userId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  priority: TaskPriorityEnum,
  dueDate: z.unknown().optional(),
  createdAt: z.unknown(),
})
