import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoActivityWithTypeSchema, kaneoFetch } from './client.js'

const UpdateActivitySchema = z.object({
  id: z.string(),
  comment: z.string(),
  createdAt: z.string(),
})

export class CommentResource {
  private log = logger.child({ scope: 'kaneo:comment-resource' })

  constructor(private config: KaneoConfig) {}

  async add(taskId: string, comment: string): Promise<{ id: string; comment: string; createdAt: string }> {
    this.log.debug({ taskId, commentLength: comment.length }, 'Adding comment')

    try {
      // Kaneo's createComment controller uses db.insert().values() without .returning(),
      // so the response is a raw Drizzle result — not an activity object.
      // The GET /activity/{taskId} endpoint is broken and doesn't return message field,
      // so we cannot fetch the comment after creation to get its ID.
      await kaneoFetch(this.config, 'POST', '/activity/comment', { taskId, comment }, undefined, z.unknown())

      // Return a placeholder since we can't get the actual ID from the broken API
      // The comment was created successfully, we just can't retrieve it
      this.log.info({ taskId, commentLength: comment.length }, 'Comment added (ID unavailable due to API limitation)')
      return {
        id: 'pending',
        comment: comment,
        createdAt: new Date().toISOString(),
      }
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to add comment')
      throw classifyKaneoError(error)
    }
  }

  async list(taskId: string): Promise<{ id: string; comment: string; createdAt: string }[]> {
    this.log.debug({ taskId }, 'Listing comments')

    try {
      const activities = await kaneoFetch(
        this.config,
        'GET',
        `/activity/${taskId}`,
        undefined,
        undefined,
        z.array(KaneoActivityWithTypeSchema),
      )

      // NOTE: Kaneo API GET /activity/{taskId} is broken - it returns activities
      // without the 'message' field, so we cannot retrieve comment text.
      // See: https://github.com/usekaneo/kaneo/issues (if reported)
      const comments = activities.flatMap((a) => {
        // Kaneo API may return comments as 'comment' or 'user_activity' type
        if (a.type !== 'comment' && a.type !== 'user_activity') {
          return []
        }
        // Check for comment text in various possible fields
        const raw = a as Record<string, unknown>
        const commentValue = a.message ?? raw['comment'] ?? raw['content'] ?? raw['text']
        if (commentValue === null || commentValue === undefined) {
          return []
        }
        // API may return various types due to broken endpoint - only accept strings
        if (typeof commentValue !== 'string') {
          return []
        }
        return [{ id: a.id, comment: commentValue, createdAt: a.createdAt ?? '' }]
      })
      this.log.info({ taskId, count: comments.length, rawCount: activities.length }, 'Comments listed')
      return comments
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list comments')
      throw classifyKaneoError(error)
    }
  }

  async update(activityId: string, comment: string): Promise<{ id: string; comment: string; createdAt: string }> {
    this.log.debug({ activityId, commentLength: comment.length }, 'Updating comment')

    try {
      const activity = await kaneoFetch(
        this.config,
        'PUT',
        '/activity/comment',
        { activityId, comment },
        undefined,
        UpdateActivitySchema,
      )
      this.log.info({ activityId }, 'Comment updated')
      return { id: activity.id, comment: activity.comment, createdAt: activity.createdAt }
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to update comment')
      throw classifyKaneoError(error)
    }
  }

  async remove(activityId: string): Promise<{ id: string; success: true }> {
    this.log.debug({ activityId }, 'Removing comment')

    try {
      await kaneoFetch(this.config, 'DELETE', '/activity/comment', { activityId }, undefined, z.unknown())
      this.log.info({ activityId }, 'Comment removed')
      return { id: activityId, success: true }
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to remove comment')
      throw classifyKaneoError(error)
    }
  }
}
