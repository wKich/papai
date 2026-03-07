/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion */
import tags, { type TagReference } from '@hcengineering/tags'
import tracker, { type Issue } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

const log = logger.child({ scope: 'huly:remove-issue-label' })

export interface RemoveIssueLabelParams {
  userId: number
  projectId: string
  issueId: string
  labelId: string
}

export interface RemoveIssueLabelResult {
  id: string
  identifier: string
  title: string
  url: string
}

export async function removeIssueLabel({
  userId,
  projectId,
  issueId,
  labelId,
}: RemoveIssueLabelParams): Promise<RemoveIssueLabelResult | undefined> {
  log.debug({ userId, projectId, issueId, labelId }, 'removeIssueLabel called')

  const client = await getHulyClient(userId)

  try {
    // First verify the issue exists
    const issue = (await client.findOne(tracker.class.Issue, {
      _id: issueId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as Issue | undefined

    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`)
    }

    // Find the TagReference for this label on this issue
    const tagRefs = (await client.findAll(tags.class.TagReference, {
      attachedTo: issueId as unknown as Parameters<typeof client.findAll>[1]['attachedTo'],
      tag: labelId as unknown as Parameters<typeof client.findAll>[1]['tag'],
    } as unknown as Parameters<typeof client.findAll>[1])) as unknown as TagReference[]

    if (tagRefs.length === 0) {
      log.warn({ userId, issueId, labelId }, 'Label not found on issue')
      return undefined
    }

    // Remove the TagReference
    const tagRefId = (tagRefs[0] as { _id: string })._id
    await client.removeCollection(
      tags.class.TagReference,
      projectId as unknown as Parameters<typeof client.removeCollection>[1],
      tagRefId as unknown as Parameters<typeof client.removeCollection>[2],
      issueId as unknown as Parameters<typeof client.removeCollection>[3],
      tracker.class.Issue,
      'labels',
    )

    log.info({ userId, issueId, labelId, identifier: issue.identifier }, 'Label removed from issue')

    // Construct URL
    const hulyUrl = process.env['HULY_URL'] ?? ''
    const hulyWorkspace = process.env['HULY_WORKSPACE'] ?? ''
    const project = (await client.findOne(tracker.class.Project, {
      _id: issue.space as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as { identifier: string } | undefined
    const projectIdentifier = project?.identifier ?? 'UNK'
    const url = `${hulyUrl}/workbench/${hulyWorkspace}/tracker/${projectIdentifier}/${issue.identifier}`

    return {
      id: issue._id as string,
      identifier: issue.identifier,
      title: issue.title,
      url,
    }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), userId, issueId, labelId },
      'removeIssueLabel failed',
    )
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
