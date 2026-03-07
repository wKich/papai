import type { Class, Ref, Doc } from '@hcengineering/core'
import tags from '@hcengineering/tags'
import tracker, { type Issue, type IssueStatus } from '@hcengineering/tracker'

// Minimal Person interface for contact lookups - extends Doc to satisfy constraints
interface Person extends Doc {
  name: string
}

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { hulyUrl, hulyWorkspace } from './env.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'

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
      // No Priority
      return 0
    case 4:
      // Urgent
      return 1
    case 3:
      // High
      return 2
    case 2:
      // Medium
      return 3
    case 1:
      // Low
      return 4
    default:
      return 0
  }
}

type HulyClient = Awaited<ReturnType<typeof getHulyClient>>

async function fetchStateName(client: HulyClient, statusId: unknown): Promise<string | undefined> {
  if (typeof statusId !== 'string') {
    return undefined
  }

  ensureRef<IssueStatus>(statusId)
  const status = await client.findOne(tracker.class.IssueStatus, { _id: statusId })

  if (status !== undefined && status !== null && 'name' in status) {
    return String(status.name)
  }
  return undefined
}

async function fetchAssigneeName(client: HulyClient, assigneeId: unknown): Promise<string | undefined> {
  if (typeof assigneeId !== 'string') {
    return undefined
  }

  ensureRef<Person>(assigneeId)
  const personClass = 'contact:class:Person'
  ensureRef<Class<Person>>(personClass)
  const assignee = await client.findOne<Person>(personClass, {
    _id: assigneeId,
  })

  if (assignee !== undefined && assignee !== null) {
    return assignee.name
  }
  return undefined
}

async function fetchLabels(client: HulyClient, issueId: Ref<Issue>): Promise<MappedLabel[]> {
  const labelRefs = await client.findAll(tags.class.TagReference, { attachedTo: issueId })

  return Promise.all(
    labelRefs.map(async (ref) => {
      const tag = await client.findOne(tags.class.TagElement, { _id: ref.tag })

      if (tag !== undefined && tag !== null && 'title' in tag && 'color' in tag) {
        return {
          id: ref._id,
          name: String(tag.title),
          color: String(tag.color),
        }
      }
      log.debug({ tagId: ref.tag }, 'Failed to parse TagElement')
      return {
        id: ref._id,
        name: 'Unknown',
        color: '#000000',
      }
    }),
  )
}

function getRelatedIssueIds(issue: Issue): string[] {
  if (!('relatedIssues' in issue)) return []
  const field: unknown = issue['relatedIssues']
  if (!Array.isArray(field)) return []
  return Array.from<unknown>(field).filter((id): id is string => typeof id === 'string')
}

async function fetchRelations(client: HulyClient, issue: Issue): Promise<MappedRelation[]> {
  const relations: MappedRelation[] = []
  const relatedIssueIds = getRelatedIssueIds(issue)

  if (relatedIssueIds.length > 0) {
    const relatedIssues = await Promise.all(
      relatedIssueIds.map((relatedId) => {
        ensureRef<Issue>(relatedId)
        return client.findOne(tracker.class.Issue, { _id: relatedId })
      }),
    )
    for (const relatedIssue of relatedIssues) {
      if (relatedIssue !== undefined) {
        relations.push({
          id: String(relatedIssue._id),
          type: 'related',
          relatedIssueId: String(relatedIssue._id),
          relatedIdentifier: relatedIssue.identifier,
        })
      }
    }
  }
  return relations
}

async function buildIssueUrl(client: HulyClient, issue: Issue): Promise<string> {
  const project = await client.findOne(tracker.class.Project, { _id: issue.space })

  if (project !== undefined && project !== null && 'identifier' in project) {
    return `${hulyUrl}/workbench/${hulyWorkspace}/tracker/${project.identifier}/${issue.identifier}`
  }

  return `${hulyUrl}/workbench/${hulyWorkspace}/tracker/UNK/${issue.identifier}`
}

async function fetchIssueData(client: HulyClient, userId: number, issueId: string): Promise<IssueData> {
  ensureRef<Issue>(issueId)
  const issue = await client.findOne(tracker.class.Issue, { _id: issueId })

  if (issue === undefined || issue === null) {
    throw new Error(`Issue not found: ${issueId}`)
  }

  const stateName =
    issue.status !== undefined && issue.status !== null ? await fetchStateName(client, issue.status) : undefined
  const assigneeName =
    issue.assignee !== undefined && issue.assignee !== null
      ? await fetchAssigneeName(client, issue.assignee)
      : undefined
  const [labels, relations] = await Promise.all([fetchLabels(client, issueId), fetchRelations(client, issue)])
  const url = await buildIssueUrl(client, issue)

  log.info(
    { userId, issueId, identifier: issue.identifier, labelCount: labels.length, relationCount: relations.length },
    'Issue fetched',
  )

  return {
    id: String(issue._id),
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description === undefined ? undefined : String(issue.description),
    priority: mapPriorityToNumber(issue.priority),
    url,
    dueDate: issue.dueDate === null ? null : new Date(issue.dueDate).toISOString(),
    estimate: issue.estimation ?? null,
    state: stateName,
    assignee: assigneeName,
    labels,
    relations,
  }
}

export async function getIssue({ userId, issueId }: { userId: number; issueId: string }): Promise<IssueData> {
  log.debug({ userId, issueId }, 'getIssue called')

  const client = await getHulyClient(userId)

  try {
    return await fetchIssueData(client, userId, issueId)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), userId, issueId }, 'getIssue failed')
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
