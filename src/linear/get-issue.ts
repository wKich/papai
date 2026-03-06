import tags, { type TagReference, type TagElement } from '@hcengineering/tags'
import tracker, { type Issue } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

const log = logger.child({ scope: 'huly:get-issue' })

interface MappedLabel {
  id: string
  name: string
  color: string
}

interface MappedRelation {
  id: string
  type: string
  relatedIssueId: string | undefined
  relatedIdentifier: string | undefined
}

interface IssueData {
  id: string
  identifier: string
  title: string
  description: string | undefined
  priority: number
  url: string
  dueDate: string | null | undefined
  estimate: number | null | undefined
  state: string | undefined
  assignee: string | undefined
  labels: MappedLabel[]
  relations: MappedRelation[]
}

function mapPriorityToNumber(hulyPriority: number): number {
  // Huly: NoPriority=0, Low=1, Medium=2, High=3, Urgent=4
  // Linear: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low
  switch (hulyPriority) {
    case 0:
      return 0 // No Priority
    case 4:
      return 1 // Urgent
    case 3:
      return 2 // High
    case 2:
      return 3 // Medium
    case 1:
      return 4 // Low
    default:
      return 0
  }
}

export async function getIssue({ userId, issueId }: { userId: number; issueId: string }): Promise<IssueData> {
  log.debug({ userId, issueId }, 'getIssue called')

  const client = await getHulyClient(userId)

  try {
    // Fetch the issue
    const issue = (await client.findOne(tracker.class.Issue, {
      _id: issueId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as Issue | undefined

    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`)
    }

    // Fetch state name
    let stateName: string | undefined
    if (issue.status) {
      const status = (await client.findOne(tracker.class.IssueStatus, {
        _id: issue.status as unknown as Parameters<typeof client.findOne>[1]['_id'],
      } as unknown as Parameters<typeof client.findOne>[1])) as unknown as { name: string } | undefined
      stateName = status?.name
    }

    // Fetch assignee name
    let assigneeName: string | undefined
    if (issue.assignee) {
      const assignee = (await client.findOne(
        'contact:class:Person' as unknown as Parameters<typeof client.findOne>[0],
        { _id: issue.assignee as unknown as Parameters<typeof client.findOne>[1]['_id'] } as unknown as Parameters<
          typeof client.findOne
        >[1],
      )) as unknown as { name: string } | undefined
      assigneeName = assignee?.name
    }

    // Fetch labels
    const labelRefs = (await client.findAll(tags.class.TagReference, {
      attachedTo: issueId as unknown as Parameters<typeof client.findAll>[1]['attachedTo'],
    } as unknown as Parameters<typeof client.findAll>[1])) as unknown as TagReference[]

    const labels: MappedLabel[] = await Promise.all(
      labelRefs.map(async (ref) => {
        const tag = (await client.findOne(tags.class.TagElement, {
          _id: ref.tag as unknown as Parameters<typeof client.findOne>[1]['_id'],
        } as unknown as Parameters<typeof client.findOne>[1])) as unknown as TagElement | undefined
        return {
          id: ref._id as string,
          name: tag?.title ?? 'Unknown',
          color: tag?.color !== undefined ? String(tag.color) : '#000000',
        }
      }),
    )

    // Relations are stored differently in Huly - check for relatedIssues field dynamically
    const relations: MappedRelation[] = []
    const relatedIssuesField = (issue as unknown as { relatedIssues?: string[] }).relatedIssues
    if (relatedIssuesField && Array.isArray(relatedIssuesField)) {
      for (const relatedId of relatedIssuesField) {
        const relatedIssue = (await client.findOne(tracker.class.Issue, {
          _id: relatedId as unknown as Parameters<typeof client.findOne>[1]['_id'],
        } as unknown as Parameters<typeof client.findOne>[1])) as unknown as Issue | undefined
        if (relatedIssue) {
          relations.push({
            id: relatedIssue._id as string,
            type: 'related',
            relatedIssueId: relatedIssue._id as string,
            relatedIdentifier: relatedIssue.identifier,
          })
        }
      }
    }

    // Construct URL
    const hulyUrl = process.env['HULY_URL'] ?? ''
    const hulyWorkspace = process.env['HULY_WORKSPACE'] ?? ''
    const project = (await client.findOne(tracker.class.Project, {
      _id: issue.space as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as { identifier: string } | undefined
    const projectIdentifier = project?.identifier ?? 'UNK'

    log.info(
      { userId, issueId, identifier: issue.identifier, labelCount: labels.length, relationCount: relations.length },
      'Issue fetched',
    )

    return {
      id: issue._id as string,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description !== undefined ? String(issue.description) : undefined,
      priority: mapPriorityToNumber(issue.priority as number),
      url: `${hulyUrl}/workbench/${hulyWorkspace}/tracker/${projectIdentifier}/${issue.identifier}`,
      dueDate: issue.dueDate !== null ? new Date(issue.dueDate).toISOString() : null,
      estimate: issue.estimation ?? null,
      state: stateName,
      assignee: assigneeName,
      labels,
      relations,
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), userId, issueId }, 'getIssue failed')
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
