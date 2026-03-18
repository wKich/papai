// src/providers/youtrack/schemas/issue-link.ts
import { z } from 'zod'

import { BaseEntitySchema, LinkTypeEnum } from './common.js'
import { IssueSchema } from './issue.js'

export const IssueLinkTypeSchema = BaseEntitySchema.extend({
  name: LinkTypeEnum,
  directed: z.boolean(),
  aggregation: z.boolean().optional(),
  localizedName: z.string().optional(),
  localizedSourceToTarget: z.string().optional(),
  localizedTargetToSource: z.string().optional(),
})

export const IssueLinkSchema = BaseEntitySchema.extend({
  type: IssueLinkTypeSchema,
  issues: z.array(z.lazy(() => IssueSchema)),
})

export const ListIssueLinksPathSchema = z.object({
  issueId: z.string(),
})

export const ListIssueLinksQuerySchema = z.object({
  fields: z.string().optional(),
})

export const ListIssueLinksRequestSchema = z.object({
  path: ListIssueLinksPathSchema,
  query: ListIssueLinksQuerySchema.optional(),
})

export const ListIssueLinksResponseSchema = z.array(IssueLinkSchema)

export const CreateIssueLinkPathSchema = z.object({
  issueId: z.string(),
})

export const CreateIssueLinkBodySchema = z.object({
  type: z.string(),
  issues: z.array(
    z.object({
      id: z.string().optional(),
      idReadable: z.string().optional(),
    }),
  ),
})

export const CreateIssueLinkRequestSchema = z.object({
  path: CreateIssueLinkPathSchema,
  body: CreateIssueLinkBodySchema,
})

export const CreateIssueLinkResponseSchema = IssueLinkSchema

export const RemoveIssueLinkPathSchema = z.object({
  issueId: z.string(),
  linkId: z.string(),
})

export const RemoveIssueLinkRequestSchema = z.object({
  path: RemoveIssueLinkPathSchema,
})

export type IssueLinkType = z.infer<typeof IssueLinkTypeSchema>
export type IssueLink = z.infer<typeof IssueLinkSchema>
export type ListIssueLinksRequest = z.infer<typeof ListIssueLinksRequestSchema>
export type ListIssueLinksResponse = z.infer<typeof ListIssueLinksResponseSchema>
export type CreateIssueLinkRequest = z.infer<typeof CreateIssueLinkRequestSchema>
export type CreateIssueLinkResponse = z.infer<typeof CreateIssueLinkResponseSchema>
export type RemoveIssueLinkRequest = z.infer<typeof RemoveIssueLinkRequestSchema>
