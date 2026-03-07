/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion */
import core, { generateId, SortingOrder } from '@hcengineering/core'
import { makeRank } from '@hcengineering/rank'
import tags from '@hcengineering/tags'
import tracker, { IssuePriority } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

const log = logger.child({ scope: 'huly:create-issue' })

export interface CreateIssueParams {
  userId: number
  title: string
  description?: string
  priority?: number
  projectId: string
  dueDate?: string
  labelIds?: string[]
  estimate?: number
}

export interface IssueResult {
  id: string
  identifier: string
  title: string
  url: string
}

export async function createIssue({
  userId,
  title,
  description,
  priority,
  projectId,
  dueDate,
  labelIds,
  estimate,
}: CreateIssueParams): Promise<IssueResult> {
  log.debug(
    {
      userId,
      title,
      projectId,
      priority: priority !== undefined,
      dueDate: dueDate !== undefined,
      estimate: estimate !== undefined,
    },
    'createIssue called',
  )

  const client = await getHulyClient(userId)

  try {
    // Get project details
    const project = await client.findOne(tracker.class.Project, {
      _id: projectId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])

    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }

    // Generate issue ID
    const issueId = generateId()

    // Increment project sequence for issue number
    const incResult = await client.updateDoc(
      tracker.class.Project,
      core.space.Space as unknown as Parameters<typeof client.updateDoc>[1],
      projectId as unknown as Parameters<typeof client.updateDoc>[2],
      {
        $inc: { sequence: 1 },
      } as unknown,
      true,
    )

    const sequence = (incResult as { object: { sequence: number } }).object.sequence

    // Get rank for ordering
    const lastIssue = await client.findOne(
      tracker.class.Issue,
      { space: projectId } as unknown as Parameters<typeof client.findOne>[1],
      { sort: { rank: SortingOrder.Descending } } as unknown as Parameters<typeof client.findOne>[2],
    )

    // Upload description if provided
    let descriptionRef: unknown = undefined
    if (description) {
      descriptionRef = await client.uploadMarkup(tracker.class.Issue, issueId, 'description', description, 'markdown')
    }

    // Map priority
    const mappedPriority = priority !== undefined ? mapPriority(priority) : IssuePriority.NoPriority

    // Create the issue
    await client.addCollection(
      tracker.class.Issue,
      projectId as unknown,
      projectId as unknown,
      tracker.class.Project,
      'issues',
      {
        title,
        description: descriptionRef,
        status: project.defaultIssueStatus,
        number: sequence,
        kind: tracker.taskTypes.Issue,
        identifier: `${project.identifier}-${sequence}`,
        priority: mappedPriority,
        assignee: null,
        component: null,
        estimation: estimate ?? 0,
        remainingTime: estimate ?? 0,
        reportedTime: 0,
        reports: 0,
        subIssues: 0,
        parents: [],
        childInfo: [],
        dueDate: parseDueDate(dueDate),
        rank: makeRank(lastIssue?.['rank'], undefined),
      } as unknown,
      issueId,
    )

    // Handle labels if provided
    if (labelIds && labelIds.length > 0) {
      for (const labelId of labelIds) {
        await client.addCollection(
          tags.class.TagReference,
          projectId as unknown,
          issueId,
          tracker.class.Issue,
          'labels',
          {
            title: '',
            color: 0,
            tag: labelId as unknown,
          } as unknown,
        )
      }
    }

    // Fetch created issue
    const issue = await client.findOne(tracker.class.Issue, { _id: issueId } as unknown as Parameters<
      typeof client.findOne
    >[1])

    if (!issue) {
      throw new Error('Issue was not created')
    }

    log.info({ issueId: issue._id, identifier: issue.identifier, title }, 'Issue created')

    // Construct URL with correct path format
    const hulyUrl = process.env['HULY_URL'] ?? ''
    const hulyWorkspace = process.env['HULY_WORKSPACE'] ?? ''
    const url = `${hulyUrl}/workbench/${hulyWorkspace}/tracker/${project.identifier}/${issue.identifier}`

    return {
      id: issue._id as string,
      identifier: issue.identifier,
      title: issue.title,
      url,
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), title, projectId }, 'createIssue failed')
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}

function parseDueDate(dueDate: string | undefined): number | null {
  if (!dueDate) return null

  const date = new Date(dueDate)
  if (isNaN(date.getTime())) {
    log.warn({ dueDate }, 'Invalid dueDate format, ignoring')
    return null
  }
  return date.getTime()
}

function mapPriority(linearPriority: number): IssuePriority {
  // Linear: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low
  // Huly: NoPriority, Low, Medium, High, Urgent
  switch (linearPriority) {
    case 0:
      return IssuePriority.NoPriority
    case 1:
      return IssuePriority.Urgent
    case 2:
      return IssuePriority.High
    case 3:
      return IssuePriority.Medium
    case 4:
      return IssuePriority.Low
    default:
      return IssuePriority.NoPriority
  }
}
