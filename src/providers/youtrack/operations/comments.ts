import { logger } from '../../../logger.js'
import type { Comment } from '../../types.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { COMMENT_FIELDS } from '../constants.js'
import { mapComment } from '../mappers.js'
import type { YtComment } from '../schemas/yt-types.js'

const log = logger.child({ scope: 'provider:youtrack:comments' })

export async function addYouTrackComment(config: YouTrackConfig, taskId: string, body: string): Promise<Comment> {
  log.debug({ taskId }, 'addComment')
  const comment = await youtrackFetch<YtComment>(config, 'POST', `/api/issues/${taskId}/comments`, {
    body: { text: body },
    query: { fields: COMMENT_FIELDS },
  })
  log.info({ taskId, commentId: comment.id }, 'Comment added')
  return mapComment(comment)
}

export async function getYouTrackComments(config: YouTrackConfig, taskId: string): Promise<Comment[]> {
  log.debug({ taskId }, 'getComments')
  const comments = await youtrackFetch<YtComment[]>(config, 'GET', `/api/issues/${taskId}/comments`, {
    query: { fields: COMMENT_FIELDS, $top: '100' },
  })
  log.info({ taskId, count: comments.length }, 'Comments retrieved')
  return comments.map(mapComment)
}

export async function updateYouTrackComment(
  config: YouTrackConfig,
  params: { taskId: string; commentId: string; body: string },
): Promise<Comment> {
  log.debug({ taskId: params.taskId, commentId: params.commentId }, 'updateComment')
  const comment = await youtrackFetch<YtComment>(
    config,
    'POST',
    `/api/issues/${params.taskId}/comments/${params.commentId}`,
    { body: { text: params.body }, query: { fields: COMMENT_FIELDS } },
  )
  log.info({ commentId: comment.id }, 'Comment updated')
  return mapComment(comment)
}

export async function removeYouTrackComment(
  config: YouTrackConfig,
  params: { taskId: string; commentId: string },
): Promise<{ id: string }> {
  log.debug({ taskId: params.taskId, commentId: params.commentId }, 'removeComment')
  await youtrackFetch(config, 'DELETE', `/api/issues/${params.taskId}/comments/${params.commentId}`)
  log.info({ taskId: params.taskId, commentId: params.commentId }, 'Comment removed')
  return { id: params.commentId }
}
