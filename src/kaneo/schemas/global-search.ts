import { z } from 'zod'

// Enums
export const SearchTypeEnum = z.enum(['all', 'tasks', 'projects', 'workspaces', 'comments', 'activities'])

export const TaskPriorityEnum = z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])

export const CommentTypeEnum = z.enum([
  'comment',
  'task',
  'status_changed',
  'priority_changed',
  'unassigned',
  'assignee_changed',
  'due_date_changed',
  'title_changed',
  'description_changed',
  'create',
])

// Query parameters
export const GlobalSearchQuerySchema = z.object({
  q: z.string().min(1),
  type: SearchTypeEnum.optional().default('all'),
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
  limit: z.string().optional().default('20'),
  userEmail: z.email().optional(),
})

// Request schema
export const GlobalSearchRequestSchema = z.object({
  query: GlobalSearchQuerySchema,
})

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

// Project schema
export const SearchProjectSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  slug: z.string(),
  icon: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.unknown(),
  isPublic: z.boolean().nullable(),
})

// Workspace schema
export const SearchWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logo: z.string().nullable(),
  metadata: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.unknown(),
})

// Comment/Activity schema
export const SearchCommentSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  type: CommentTypeEnum,
  createdAt: z.unknown(),
  userId: z.string().nullable(),
  content: z.string().nullable(),
  externalUserName: z.string().nullable(),
  externalUserAvatar: z.string().nullable(),
  externalSource: z.string().nullable(),
  externalUrl: z.string().nullable(),
})

// Response schema
export const GlobalSearchResponseSchema = z.object({
  tasks: z.array(SearchTaskSchema),
  projects: z.array(SearchProjectSchema),
  workspaces: z.array(SearchWorkspaceSchema),
  comments: z.array(SearchCommentSchema),
  activities: z.array(SearchCommentSchema),
})

// TypeScript types
export type SearchType = z.infer<typeof SearchTypeEnum>
export type TaskPriority = z.infer<typeof TaskPriorityEnum>
export type CommentType = z.infer<typeof CommentTypeEnum>
export type GlobalSearchQuery = z.infer<typeof GlobalSearchQuerySchema>
export type GlobalSearchRequest = z.infer<typeof GlobalSearchRequestSchema>
export type SearchTask = z.infer<typeof SearchTaskSchema>
export type SearchProject = z.infer<typeof SearchProjectSchema>
export type SearchWorkspace = z.infer<typeof SearchWorkspaceSchema>
export type SearchComment = z.infer<typeof SearchCommentSchema>
export type GlobalSearchResponse = z.infer<typeof GlobalSearchResponseSchema>
