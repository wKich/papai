import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'
import { CreateCommentResponseSchema } from './schemas/createComment.js'
import { ActivityItemSchema } from './schemas/getActivities.js'
import { UpdateCommentResponseSchema } from './schemas/updateComment.js'

export class CommentResource {
  private log = logger.child({ scope: 'kaneo:comment-resource' })

  constructor(private config: KaneoConfig) {}

  async add(taskId: string, comment: string): Promise<{ id: string; comment: string; createdAt: string }> {
    this.log.debug({ taskId, commentLength: comment.length }, 'Adding comment')

    try {
      // Create comment and parse response per API documentation
      const response = await kaneoFetch(
        this.config,
        'POST',
        '/activity/comment',
        { taskId, comment },
        undefined,
        CreateCommentResponseSchema,
      )

      this.log.info({ taskId, activityId: response.id }, 'Comment added')
      return {
        id: response.id,
        comment: response.content ?? comment,
        createdAt: typeof response.createdAt === 'string' ? response.createdAt : JSON.stringify(response.createdAt),
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
        z.array(ActivityItemSchema),
      )

      // Filter and extract comments from activities
      const comments = activities.flatMap((a) => {
        // Kaneo API may return comments as 'comment' type
        if (a.type !== 'comment') {
          return []
        }
        // Comment text is in 'content' field per API documentation
        const commentValue = a.content
        if (commentValue === null || commentValue === undefined) {
          return []
        }
        return [
          {
            id: a.id,
            comment: commentValue,
            createdAt: typeof a.createdAt === 'string' ? a.createdAt : JSON.stringify(a.createdAt),
          },
        ]
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
        UpdateCommentResponseSchema,
      )
      this.log.info({ activityId }, 'Comment updated')
      return {
        id: activity.id,
        comment: activity.content ?? comment,
        createdAt: typeof activity.createdAt === 'string' ? activity.createdAt : JSON.stringify(activity.createdAt),
      }
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
