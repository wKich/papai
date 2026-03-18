// src/providers/youtrack/schemas/issue.ts
import { z } from 'zod'

import { BaseEntitySchema, TimestampSchema } from './common.js'
import { CustomFieldValueSchema } from './custom-fields.js'
import { TagSchema } from './tag.js'
import { UserSchema } from './user.js'

// IssueProjectSchema - minimal project reference for issues
export const IssueProjectSchema = BaseEntitySchema.extend({
  name: z.string().optional(),
  shortName: z.string().optional(),
})

export const IssueSchema = BaseEntitySchema.extend({
  idReadable: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  project: IssueProjectSchema,
  reporter: z.lazy(() => UserSchema).optional(),
  updater: z.lazy(() => UserSchema).optional(),
  created: TimestampSchema,
  updated: TimestampSchema,
  resolved: TimestampSchema.optional(),
  customFields: z.array(CustomFieldValueSchema),
  tags: z.array(z.lazy(() => TagSchema)).optional(),
  commentsCount: z.number().optional(),
  votes: z.number().optional(),
})

export const CreateIssueRequestSchema = z.object({
  summary: z.string(),
  description: z.string().optional(),
  project: z.object({ id: z.string() }),
  customFields: z
    .array(
      z.object({
        name: z.string(),
        $type: z.string(),
        value: z.unknown(),
      }),
    )
    .optional(),
  tags: z.array(z.object({ id: z.string() })).optional(),
})

export const CreateIssueResponseSchema = IssueSchema

export const ListIssuesPathSchema = z.object({
  projectId: z.string(),
})

export const ListIssuesQuerySchema = z.object({
  fields: z.string().optional(),
  $skip: z.number().optional(),
  $top: z.number().optional(),
})

export const ListIssuesRequestSchema = z.object({
  path: ListIssuesPathSchema,
  query: ListIssuesQuerySchema.optional(),
})

export const ListIssuesResponseSchema = z.array(IssueSchema)

export const SearchIssuesQuerySchema = z.object({
  query: z.string().optional(),
  fields: z.string().optional(),
  $skip: z.number().optional(),
  $top: z.number().optional(),
})

// SearchIssuesRequestSchema accepts query params directly (flat structure)
export const SearchIssuesRequestSchema = SearchIssuesQuerySchema

export const SearchIssuesResponseSchema = z.array(IssueSchema)

export const GetIssuePathSchema = z.object({
  issueId: z.string(),
})

export const GetIssueQuerySchema = z.object({
  fields: z.string().optional(),
})

export const GetIssueRequestSchema = z.object({
  path: GetIssuePathSchema,
  query: GetIssueQuerySchema.optional(),
})

export const GetIssueResponseSchema = IssueSchema

export const UpdateIssuePathSchema = z.object({
  issueId: z.string(),
})

export const UpdateIssueBodySchema = z.object({
  summary: z.string().optional(),
  description: z.string().optional(),
  customFields: z
    .array(
      z.object({
        name: z.string(),
        $type: z.string(),
        value: z.unknown(),
      }),
    )
    .optional(),
})

export const UpdateIssueRequestSchema = z.object({
  path: UpdateIssuePathSchema,
  body: UpdateIssueBodySchema,
})

export const UpdateIssueResponseSchema = IssueSchema

export const DeleteIssuePathSchema = z.object({
  issueId: z.string(),
})

export const DeleteIssueRequestSchema = z.object({
  path: DeleteIssuePathSchema,
})

export type Issue = z.infer<typeof IssueSchema>
export type CreateIssueRequest = z.infer<typeof CreateIssueRequestSchema>
export type CreateIssueResponse = z.infer<typeof CreateIssueResponseSchema>
export type ListIssuesRequest = z.infer<typeof ListIssuesRequestSchema>
export type ListIssuesResponse = z.infer<typeof ListIssuesResponseSchema>
export type SearchIssuesRequest = z.infer<typeof SearchIssuesRequestSchema>
export type SearchIssuesResponse = z.infer<typeof SearchIssuesResponseSchema>
export type GetIssueRequest = z.infer<typeof GetIssueRequestSchema>
export type GetIssueResponse = z.infer<typeof GetIssueResponseSchema>
export type UpdateIssueRequest = z.infer<typeof UpdateIssueRequestSchema>
export type UpdateIssueResponse = z.infer<typeof UpdateIssueResponseSchema>
export type DeleteIssueRequest = z.infer<typeof DeleteIssueRequestSchema>
