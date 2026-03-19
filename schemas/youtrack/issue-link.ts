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

export const CreateIssueLinkRequestSchema = z.object({
  path: z.object({
    issueId: z.string(),
  }),
  body: z.object({
    type: z.string(),
    issues: z.array(
      z.object({
        id: z.string().optional(),
        idReadable: z.string().optional(),
      }),
    ),
  }),
})

export const RemoveIssueLinkRequestSchema = z.object({
  path: z.object({
    issueId: z.string(),
    linkId: z.string(),
  }),
})
