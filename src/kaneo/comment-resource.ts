import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoActivitySchema, KaneoActivityWithTypeSchema, kaneoFetch } from './client.js'

const UpdateActivitySchema = z.object({
  id: z.string(),
  comment: z.string(),
})

export class CommentResource {
  private log = logger.child({ scope: 'kaneo:comment-resource' })

  constructor(private config: KaneoConfig) {}

  async add(taskId: string, comment: string): Promise<{ id: string; comment: string; createdAt: string }> {
    this.log.debug({ taskId, commentLength: comment.length }, 'Adding comment')

    try {
      const activity = await kaneoFetch(
        this.config,
        'POST',
        '/activity/comment',
        { taskId, comment },
        undefined,
        KaneoActivitySchema,
      )
      this.log.info({ taskId, activityId: activity.id }, 'Comment added')
      return { id: activity.id, comment: activity.comment, createdAt: activity.createdAt }
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
      const comments = activities
        .filter((a) => a.type === 'comment' && a.comment !== null)
        .map((a) => ({
          id: a.id,
          comment: a.comment!,
          createdAt: a.createdAt,
        }))
      this.log.info({ taskId, count: comments.length }, 'Comments listed')
      return comments
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list comments')
      throw classifyKaneoError(error)
    }
  }

  async update(activityId: string, comment: string): Promise<{ id: string; comment: string }> {
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
      return { id: activity.id, comment: activity.comment }
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
