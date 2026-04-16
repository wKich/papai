import { logger } from '../../../logger.js'
import type { Comment } from '../../types.js'
import { classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { COMMENT_FIELDS } from '../constants.js'
import { paginate } from '../helpers.js'
import { mapComment } from '../mappers.js'
import { CommentSchema } from '../schemas/comment.js'

const log = logger.child({ scope: 'provider:youtrack:comments' })

export async function addYouTrackComment(config: YouTrackConfig, taskId: string, body: string): Promise<Comment> {
  log.debug({ taskId }, 'addComment')
  try {
    const raw = await youtrackFetch(config, 'POST', `/api/issues/${taskId}/comments`, {
      body: { text: body },
      query: { fields: COMMENT_FIELDS },
    })
    const comment = CommentSchema.parse(raw)
    log.info({ taskId, commentId: comment.id }, 'Comment added')
    return mapComment(comment)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to add comment')
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function getYouTrackComment(config: YouTrackConfig, taskId: string, commentId: string): Promise<Comment> {
  log.debug({ taskId, commentId }, 'getComment')
  try {
    const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}/comments/${commentId}`, {
      query: { fields: COMMENT_FIELDS },
    })
    const comment = CommentSchema.parse(raw)
    log.info({ taskId, commentId: comment.id }, 'Comment retrieved')
    return mapComment(comment)
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, commentId },
      'Failed to get comment',
    )
    throw classifyYouTrackError(error, { taskId, commentId })
  }
}

export async function getYouTrackComments(
  config: YouTrackConfig,
  taskId: string,
  params?: { limit?: number; offset?: number },
): Promise<Comment[]> {
  log.debug({ taskId, params }, 'getComments')
  try {
    if (params?.limit !== undefined || params?.offset !== undefined) {
      const query: Record<string, string> = { fields: COMMENT_FIELDS }
      if (params.limit !== undefined) {
        query['$top'] = String(params.limit)
      }
      if (params.offset !== undefined) {
        query['$skip'] = String(params.offset)
      }

      const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}/comments`, { query })
      const comments = CommentSchema.array().parse(raw)
      log.info({ taskId, count: comments.length }, 'Comments retrieved')
      return comments.map(mapComment)
    }

    const comments = await paginate(
      config,
      `/api/issues/${taskId}/comments`,
      { fields: COMMENT_FIELDS },
      CommentSchema.array(),
    )
    log.info({ taskId, count: comments.length }, 'Comments retrieved')
    return comments.map(mapComment)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to get comments')
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function updateYouTrackComment(
  config: YouTrackConfig,
  params: { taskId: string; commentId: string; body: string },
): Promise<Comment> {
  const { taskId, commentId } = params
  log.debug({ taskId, commentId }, 'updateComment')
  try {
    const raw = await youtrackFetch(config, 'POST', `/api/issues/${taskId}/comments/${commentId}`, {
      body: { text: params.body },
      query: { fields: COMMENT_FIELDS },
    })
    const comment = CommentSchema.parse(raw)
    log.info({ commentId: comment.id }, 'Comment updated')
    return mapComment(comment)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), commentId }, 'Failed to update comment')
    throw classifyYouTrackError(error, { taskId, commentId })
  }
}

export async function removeYouTrackComment(
  config: YouTrackConfig,
  params: { taskId: string; commentId: string },
): Promise<{ id: string }> {
  const { taskId, commentId } = params
  log.debug({ taskId, commentId }, 'removeComment')
  try {
    await youtrackFetch(config, 'DELETE', `/api/issues/${taskId}/comments/${commentId}`)
    log.info({ taskId, commentId }, 'Comment removed')
    return { id: commentId }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), commentId }, 'Failed to remove comment')
    throw classifyYouTrackError(error, { taskId, commentId })
  }
}
