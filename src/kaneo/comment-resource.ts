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
      // We need to fetch the comment after creation to get its ID.
      await kaneoFetch(this.config, 'POST', '/activity/comment', { taskId, comment }, undefined, z.unknown())

      // Fetch the newly created comment to get its ID and createdAt
      // We find the most recent comment instead of matching by text,
      // because the API may transform text (trim whitespace, etc.) and
      // text-based matching is fragile with duplicates
      const comments = await this.list(taskId)
      if (comments.length === 0) {
        throw new Error('Failed to retrieve created comment: no comments found')
      }
      // Sort by createdAt descending to get the newest comment first
      const sortedComments = comments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      const newComment = sortedComments[0]!

      this.log.info(
        { taskId, commentId: newComment.id, commentText: newComment.comment.substring(0, 50) },
        'Comment added',
      )
      return { id: newComment.id, comment: newComment.comment, createdAt: newComment.createdAt }
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
      const comments = activities.flatMap((a) => {
        if (a.type !== 'comment') return []
        // Kaneo stores comment text in the 'message' field, not 'comment'
        const commentText = a.message
        if (commentText === null || commentText === undefined) return []
        return [{ id: a.id, comment: commentText, createdAt: a.createdAt ?? '' }]
      })
      this.log.info({ taskId, count: comments.length }, 'Comments listed')
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
