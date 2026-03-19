// src/providers/youtrack/schemas/yt-types.ts
import { z } from 'zod'

/**
 * Production-oriented Zod schemas that match what YouTrack API actually returns
 * for the field queries defined in constants.ts (ISSUE_FIELDS, COMMENT_FIELDS, etc.)
 *
 * These replace the plain TypeScript interfaces in types.ts.
 * The more detailed schemas in other files (IssueSchema, UserSchema, etc.) remain
 * for test-level validation.
 */

/** Custom field value: object with optional name/login, or a primitive. */
const YtCustomFieldValueSchema = z
  .union([z.object({ name: z.string().optional(), login: z.string().optional() }), z.string(), z.number(), z.boolean()])
  .nullable()
  .optional()

/**
 * Custom field as returned by `customFields($type,name,value($type,name,login))`.
 * Loose $type (any string) to handle unknown field types gracefully.
 */
const YtCustomFieldSchema = z.object({
  $type: z.string(),
  name: z.string(),
  value: YtCustomFieldValueSchema,
})

/** Issue link as returned by `links(id,direction,linkType(name,...),issues(id,idReadable,summary))`. */
export const YtIssueLinkSchema = z.object({
  id: z.string().optional(),
  direction: z.string(),
  linkType: z
    .object({
      name: z.string().optional(),
      sourceToTarget: z.string().optional(),
      targetToSource: z.string().optional(),
    })
    .optional(),
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

/** Tag as returned by `tags(id,name,color(id,background))`. */
const YtTagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.object({ background: z.string().optional() }).nullable().optional(),
})

/** Full issue schema matching ISSUE_FIELDS query. */
export const YtIssueSchema = z.object({
  id: z.string(),
  idReadable: z.string().optional(),
  summary: z.string(),
  description: z.string().optional(),
  created: z.number().optional(),
  updated: z.number().optional(),
  resolved: z.number().nullable().optional(),
  project: z
    .object({
      id: z.string(),
      shortName: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  customFields: z.array(YtCustomFieldSchema).optional(),
  tags: z.array(YtTagSchema).optional(),
  links: z.array(YtIssueLinkSchema).optional(),
})

/** Partial issue schema for relation lookup (fields: `id,links(...)`). */
export const YtIssueLinksSchema = z.object({
  id: z.string(),
  links: z.array(YtIssueLinkSchema).optional(),
})

/** Partial issue schema for tag/label reads (fields: `id,tags(id)`). */
export const YtIssueTagsSchema = z.object({
  tags: z.array(z.object({ id: z.string() })).optional(),
})

/** Comment schema matching COMMENT_FIELDS query. */
export const YtCommentSchema = z.object({
  id: z.string(),
  text: z.string(),
  author: z
    .object({
      login: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  created: z.number().optional(),
})

/** Project schema matching PROJECT_FIELDS query. */
export const YtProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string().optional(),
  description: z.string().optional(),
  archived: z.boolean().optional(),
})

/** Tag/label schema matching TAG_FIELDS query. */
export const YtLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.object({ background: z.string().optional() }).nullable().optional(),
})

// Inferred types — replace the plain interfaces in types.ts
export type YtIssue = z.infer<typeof YtIssueSchema>
export type YtComment = z.infer<typeof YtCommentSchema>
export type YtProject = z.infer<typeof YtProjectSchema>
export type YtLabel = z.infer<typeof YtLabelSchema>
export type YtIssueLinks = z.infer<typeof YtIssueLinksSchema>
export type YtIssueTags = z.infer<typeof YtIssueTagsSchema>
