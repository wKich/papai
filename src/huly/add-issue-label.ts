import tags from '@hcengineering/tags'
import tracker, { type Issue } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

const log = logger.child({ scope: 'huly:add-issue-label' })

export interface AddIssueLabelParams {
  userId: number
  projectId: string
  issueId: string
  labelId: string
}

export interface AddIssueLabelResult {
  id: string
  identifier: string
  title: string
  url: string
}

export async function addIssueLabel({
  userId,
  projectId,
  issueId,
  labelId,
}: AddIssueLabelParams): Promise<AddIssueLabelResult> {
  log.debug({ userId, projectId, issueId, labelId }, 'addIssueLabel called')

  const client = await getHulyClient(userId)

  try {
    // First verify the issue exists
    const issue = (await client.findOne(tracker.class.Issue, {
      _id: issueId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as Issue | undefined

    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`)
    }

    // Add label to issue using TagReference collection
    await client.addCollection(
      tags.class.TagReference,
      projectId as unknown as Parameters<typeof client.addCollection>[1],
      issueId as unknown as Parameters<typeof client.addCollection>[2],
      tracker.class.Issue,
      'labels',
      {
        title: '',
        color: 0,
        tag: labelId as unknown,
      } as unknown as Parameters<typeof client.addCollection>[5],
    )

    log.info({ userId, issueId, labelId, identifier: issue.identifier }, 'Label added to issue')

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
      'addIssueLabel failed',
    )
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
