import { logger } from '../../../logger.js'
import type { Comment } from '../../types.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { classifyYouTrackError } from '../classify-error.js'
import { COMMENT_FIELDS } from '../constants.js'
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

export async function getYouTrackComments(config: YouTrackConfig, taskId: string): Promise<Comment[]> {
  log.debug({ taskId }, 'getComments')
  try {
    const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}/comments`, {
      query: { fields: COMMENT_FIELDS, $top: '100' },
    })
    const comments = CommentSchema.array().parse(raw)
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
