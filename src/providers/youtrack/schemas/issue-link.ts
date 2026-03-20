// src/providers/youtrack/schemas/issue-link.ts
import { z } from 'zod'

import { BaseEntitySchema } from './common.js'

/** IssueLinkType as embedded inside an issue link object. */
// IssueLinkType.name is free-form: YouTrack allows custom link type names beyond the built-in set.
const IssueLinkTypeSchema = BaseEntitySchema.extend({
  name: z.string(),
  directed: z.boolean().optional(),
  aggregation: z.boolean().optional(),
  sourceToTarget: z.string().optional(),
  targetToSource: z.string().optional(),
  localizedName: z.string().optional(),
  localizedSourceToTarget: z.string().optional(),
  localizedTargetToSource: z.string().optional(),
})

/**
 * IssueLink as returned inside an issue's `links` field.
 * Matches field query: links(id,direction,linkType(name,sourceToTarget,targetToSource),issues(id,idReadable,summary))
 */
export const IssueLinkSchema = z.object({
  id: z.string().optional(),
  $type: z.string().optional(),
  direction: z.string().optional(),
  linkType: IssueLinkTypeSchema.optional(),
  issues: z
    .array(
      z.object({
        id: z.string(),
        idReadable: z.string().optional(),
        summary: z.string().optional(),
      }),
    )
    .optional(),
})
