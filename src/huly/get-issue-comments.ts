/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion */
import chunter, { type ChatMessage } from '@hcengineering/chunter'
import tracker, { type Issue } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

const log = logger.child({ scope: 'huly:get-issue-comments' })

export interface GetIssueCommentsParams {
  userId: number
  issueId: string
}

export interface GetIssueCommentsResult {
  id: string
  body: string
  createdAt: Date
}

export async function getIssueComments({ userId, issueId }: GetIssueCommentsParams): Promise<GetIssueCommentsResult[]> {
  log.debug({ userId, issueId }, 'getIssueComments called')

  const client = await getHulyClient(userId)

  try {
    // First verify the issue exists
    const issue = (await client.findOne(tracker.class.Issue, {
      _id: issueId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as Issue | undefined

    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`)
    }

    // Fetch comments using findAll with attachedTo filter
    const comments = (await client.findAll(chunter.class.ChatMessage, {
      attachedTo: issueId as unknown as Parameters<typeof client.findAll>[1]['attachedTo'],
    } as unknown as Parameters<typeof client.findAll>[1])) as unknown as ChatMessage[]

    const result: GetIssueCommentsResult[] = comments
      .filter((comment) => {
        // Validate required fields
        if (typeof comment._id !== 'string' || typeof comment.message !== 'string') {
          log.warn({ userId, issueId, commentId: comment._id }, 'Skipping comment with invalid response shape')
          return false
        }
        return true
      })
      .map((comment) => {
        const createdAt =
          typeof comment.modifiedOn === 'number'
            ? new Date(comment.modifiedOn)
            : typeof comment.createdOn === 'number'
              ? new Date(comment.createdOn)
              : new Date()
        return {
          id: comment._id as string,
          body: comment.message,
          createdAt,
        }
      })

    log.info({ userId, issueId, commentCount: result.length }, 'Comments fetched')
    return result
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), userId, issueId },
      'getIssueComments failed',
    )
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
