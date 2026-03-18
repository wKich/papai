// src/providers/youtrack/schemas/tag.ts
import { z } from 'zod'

import { BaseEntitySchema } from './common.js'

export const FieldStyleSchema = z.object({
  $type: z.string().optional(),
  id: z.string().optional(),
  background: z.string(),
  foreground: z.string().optional(),
})

export const TagSchema = BaseEntitySchema.extend({
  name: z.string(),
  color: FieldStyleSchema.optional(),
  untagOnResolve: z.boolean().optional(),
  owner: z.object({ id: z.string() }).optional(),
})

export const CreateTagRequestSchema = z.object({
  name: z.string(),
  color: FieldStyleSchema.optional(),
  untagOnResolve: z.boolean().optional(),
})

export const CreateTagResponseSchema = TagSchema

export const ListTagsQuerySchema = z.object({
  fields: z.string().optional(),
  $skip: z.number().optional(),
  $top: z.number().optional(),
})

export const ListTagsRequestSchema = z.object({
  query: ListTagsQuerySchema,
})

export const ListTagsResponseSchema = z.array(TagSchema)

export const AddTagToIssuePathSchema = z.object({
  issueId: z.string(),
})

export const AddTagToIssueBodySchema = z.object({
  id: z.string(),
  $type: z.string().optional(),
})

export const AddTagToIssueRequestSchema = z.object({
  path: AddTagToIssuePathSchema,
  body: AddTagToIssueBodySchema,
})

export const RemoveTagFromIssuePathSchema = z.object({
  issueId: z.string(),
  tagId: z.string(),
})

export const RemoveTagFromIssueRequestSchema = z.object({
  path: RemoveTagFromIssuePathSchema,
})

export const UpdateTagPathSchema = z.object({
  tagId: z.string(),
})

export const UpdateTagBodySchema = z.object({
  name: z.string().optional(),
  color: FieldStyleSchema.optional(),
  untagOnResolve: z.boolean().optional(),
})

export const UpdateTagRequestSchema = z.object({
  path: UpdateTagPathSchema,
  body: UpdateTagBodySchema,
})

export const UpdateTagResponseSchema = TagSchema

export const DeleteTagPathSchema = z.object({
  tagId: z.string(),
})

export const DeleteTagRequestSchema = z.object({
  path: DeleteTagPathSchema,
})

export type Tag = z.infer<typeof TagSchema>
export type FieldStyle = z.infer<typeof FieldStyleSchema>
export type CreateTagRequest = z.infer<typeof CreateTagRequestSchema>
export type CreateTagResponse = z.infer<typeof CreateTagResponseSchema>
export type ListTagsRequest = z.infer<typeof ListTagsRequestSchema>
export type ListTagsResponse = z.infer<typeof ListTagsResponseSchema>
export type AddTagToIssueRequest = z.infer<typeof AddTagToIssueRequestSchema>
export type RemoveTagFromIssueRequest = z.infer<typeof RemoveTagFromIssueRequestSchema>
export type UpdateTagRequest = z.infer<typeof UpdateTagRequestSchema>
export type UpdateTagResponse = z.infer<typeof UpdateTagResponseSchema>
export type DeleteTagRequest = z.infer<typeof DeleteTagRequestSchema>
