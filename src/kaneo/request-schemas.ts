/**
 * Zod schemas for Kaneo API request bodies, derived from the official API
 * route validators in apps/api/src/ of the usekaneo/kaneo repository.
 *
 * Used to validate request payloads before they are sent, catching type
 * mismatches (e.g. null where string is expected) before an HTTP round-trip.
 */
import { z } from 'zod'

// POST /task/:projectId
export const CreateTaskBodySchema = z.object({
  title: z.string(),
  description: z.string(),
  dueDate: z.string().optional(),
  priority: z.string(),
  status: z.string(),
  userId: z.string().optional(),
})

// PUT /task/description/:id
export const UpdateTaskDescriptionBodySchema = z.object({
  description: z.string(),
})

// POST /label
export const CreateLabelBodySchema = z.object({
  name: z.string(),
  color: z.string(),
  workspaceId: z.string(),
  taskId: z.string().optional(),
})

// PUT /label/:id
export const UpdateLabelBodySchema = z.object({
  name: z.string(),
  color: z.string(),
})

// POST /project
export const CreateProjectBodySchema = z.object({
  name: z.string(),
  workspaceId: z.string(),
  icon: z.string(),
  slug: z.string(),
})

// PUT /project/:id — all fields required
export const UpdateProjectBodySchema = z.object({
  name: z.string(),
  icon: z.string(),
  slug: z.string(),
  description: z.string(),
  isPublic: z.boolean(),
})

// POST /column/:projectId
export const CreateColumnBodySchema = z.object({
  name: z.string(),
  icon: z.string().optional(),
  color: z.string().optional(),
  isFinal: z.boolean().optional(),
})

// POST /activity/comment
export const CreateCommentBodySchema = z.object({
  taskId: z.string(),
  comment: z.string(),
})

// PUT /activity/comment
export const UpdateCommentBodySchema = z.object({
  activityId: z.string(),
  comment: z.string(),
})

// DELETE /activity/comment
export const DeleteCommentBodySchema = z.object({
  activityId: z.string(),
})
