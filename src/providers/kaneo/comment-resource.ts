import { z } from 'zod'

import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'
// Both compat schemas accept {} from buggy endpoints lacking .returning().
// See src/kaneo/schemas/api-compat.ts for upstream bug references.
import { CreateCommentResponseCompatSchema, UpdateCommentResponseCompatSchema } from './schemas/api-compat.js'
import { ActivityItemSchema } from './schemas/getActivities.js'

export class CommentResource {
  private log = logger.child({ scope: 'kaneo:comment-resource' })

  constructor(private config: KaneoConfig) {}

  async add(taskId: string, comment: string): Promise<{ id: string; comment: string; createdAt: string }> {
    this.log.debug({ taskId, commentLength: comment.length }, 'Adding comment')

    try {
      // POST /activity/comment returns {} due to a missing .returning() in the Kaneo API.
      // See: https://github.com/usekaneo/kaneo/blob/main/apps/api/src/activity/controllers/create-comment.ts
      // We discard the response and immediately fetch the activity list to get the real created comment.
      await kaneoFetch(
        this.config,
        'POST',
        '/activity/comment',
        { taskId, comment },
        undefined,
        CreateCommentResponseCompatSchema,
      )

      const activities = await kaneoFetch(
        this.config,
        'GET',
        `/activity/${taskId}`,
        undefined,
        undefined,
        z.array(ActivityItemSchema),
      )

      // The newest comment is first in the list; find the first matching content.
      const created = activities.find((a) => a.type === 'comment' && a.content === comment)
      if (created === undefined) {
        throw new Error('Comment was posted but could not be found in subsequent activity fetch')
      }

      this.log.info({ taskId, activityId: created.id }, 'Comment added')
      return {
        id: created.id,
        comment: created.content ?? comment,
        createdAt: typeof created.createdAt === 'string' ? created.createdAt : new Date().toISOString(),
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

  async update(
    taskId: string,
    activityId: string,
    comment: string,
  ): Promise<{ id: string; comment: string; createdAt: string }> {
    this.log.debug({ taskId, activityId, commentLength: comment.length }, 'Updating comment')

    try {
      // PUT /activity/comment returns {} due to a missing .returning() in the Kaneo API.
      // See: https://github.com/usekaneo/kaneo/blob/main/apps/api/src/activity/controllers/update-comment.ts
      // We discard the response and fetch the activity list to confirm and return the updated comment.
      await kaneoFetch(
        this.config,
        'PUT',
        '/activity/comment',
        { activityId, comment },
        undefined,
        UpdateCommentResponseCompatSchema,
      )

      const activities = await kaneoFetch(
        this.config,
        'GET',
        `/activity/${taskId}`,
        undefined,
        undefined,
        z.array(ActivityItemSchema),
      )

      const updated = activities.find((a) => a.id === activityId)
      if (updated === undefined) {
        throw new Error('Comment was updated but could not be found in subsequent activity fetch')
      }

      this.log.info({ taskId, activityId }, 'Comment updated')
      return {
        id: updated.id,
        comment: updated.content ?? comment,
        createdAt: typeof updated.createdAt === 'string' ? updated.createdAt : new Date().toISOString(),
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
