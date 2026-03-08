import type { AttachedData, MarkupBlobRef, Ref } from '@hcengineering/core'
import core, { generateId, SortingOrder } from '@hcengineering/core'
import { makeRank } from '@hcengineering/rank'
import tags, { type TagElement } from '@hcengineering/tags'
import tracker, { type IssueChildInfo, type IssueParentInfo, type Project, type Issue } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { hulyUrl, hulyWorkspace } from './env.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'
import type { HulyClient } from './types.js'
import { mapInputPriorityToHuly } from './utils/priority.js'
import { withClient } from './utils/with-client.js'

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

function parseDueDate(dueDate: string | undefined): number | null {
  if (dueDate === undefined) {
    return null
  }

  const date = new Date(dueDate)
  if (isNaN(date.getTime())) {
    log.warn({ dueDate }, 'Invalid dueDate format, ignoring')
    return null
  }
  return date.getTime()
}

async function fetchProject(client: HulyClient, projectId: Ref<Project>): Promise<Project | undefined> {
  return (await client.findOne(tracker.class.Project, { _id: projectId })) ?? undefined
}

async function getProjectSequence(client: HulyClient, projectId: Ref<Project>): Promise<number> {
  await client.updateDoc(tracker.class.Project, core.space.Space, projectId, { $inc: { sequence: 1 } }, false)

  const updated = await client.findOne(tracker.class.Project, { _id: projectId })

  if (updated === undefined || updated === null) {
    throw new Error('Project not found after sequence increment')
  }
  return updated.sequence
}

interface IssueWithRank {
  rank?: string
}

async function fetchLastIssue(client: HulyClient, projectId: Ref<Project>): Promise<IssueWithRank | undefined> {
  const result = await client.findOne(
    tracker.class.Issue,
    { space: projectId },
    { sort: { rank: SortingOrder.Descending } },
  )

  if (result !== undefined && result !== null && 'rank' in result) {
    return { rank: String(result.rank) }
  }
  return undefined
}

function uploadDescription(
  client: HulyClient,
  issueId: Ref<Issue>,
  description: string | undefined,
): Promise<MarkupBlobRef | null> {
  if (description === undefined) {
    return Promise.resolve(null)
  }
  return client.uploadMarkup(tracker.class.Issue, issueId, 'description', description, 'markdown')
}

async function addLabelsConcurrently(
  client: HulyClient,
  projectId: Ref<Project>,
  issueId: Ref<Issue>,
  labelIds: string[] | undefined,
): Promise<void> {
  if (labelIds === undefined || labelIds.length === 0) {
    return
  }

  const labelPromises = labelIds.map((labelId) => {
    ensureRef<TagElement>(labelId)
    return client.addCollection(tags.class.TagReference, projectId, issueId, tracker.class.Issue, 'labels', {
      title: '',
      color: 0,
      tag: labelId,
    })
  })

  await Promise.all(labelPromises)
}

function buildIssueData(
  project: Project,
  title: string,
  descriptionRef: MarkupBlobRef | null,
  sequence: number,
  priority: number | undefined,
  estimate: number | undefined,
  dueDate: string | undefined,
  lastIssue: IssueWithRank | undefined,
): AttachedData<Issue> {
  const parents: IssueParentInfo[] = []
  const childInfo: IssueChildInfo[] = []
  return {
    rank: makeRank(lastIssue?.rank, undefined),
    title,
    description: descriptionRef,
    status: project.defaultIssueStatus,
    number: sequence,
    kind: tracker.taskTypes.Issue,
    identifier: `${project.identifier}-${sequence}`,
    priority: mapInputPriorityToHuly(priority),
    assignee: null,
    component: null,
    estimation: estimate ?? 0,
    remainingTime: estimate ?? 0,
    reportedTime: 0,
    reports: 0,
    subIssues: 0,
    parents,
    childInfo,
    dueDate: parseDueDate(dueDate),
  }
}

async function createIssueInHuly(
  client: HulyClient,
  issueId: Ref<Issue>,
  projectId: Ref<Project>,
  issueData: AttachedData<Issue>,
): Promise<void> {
  await client.addCollection(
    tracker.class.Issue,
    projectId,
    projectId,
    tracker.class.Project,
    'issues',
    issueData,
    issueId,
  )
}

async function fetchCreatedIssue(client: HulyClient, issueId: Ref<Issue>): Promise<Issue | undefined> {
  return (await client.findOne(tracker.class.Issue, { _id: issueId })) ?? undefined
}

async function finalizeIssueCreation(
  client: HulyClient,
  project: Project,
  issueId: Ref<Issue>,
): Promise<{ issue: IssueResult; url: string }> {
  const fetchedIssue = await fetchCreatedIssue(client, issueId)
  if (fetchedIssue === undefined) {
    throw new Error('Issue was not created')
  }

  const url = `${hulyUrl}/workbench/${hulyWorkspace}/tracker/${project.identifier}/${fetchedIssue.identifier}`

  return {
    issue: {
      id: fetchedIssue._id,
      identifier: fetchedIssue.identifier,
      title: fetchedIssue.title,
      url,
    },
    url,
  }
}

async function createIssueCore(
  client: HulyClient,
  projectId: string,
  title: string,
  description: string | undefined,
  priority: number | undefined,
  dueDate: string | undefined,
  labelIds: string[] | undefined,
  estimate: number | undefined,
): Promise<{ issue: IssueResult; url: string }> {
  ensureRef<Project>(projectId)

  const project = await fetchProject(client, projectId)
  if (project === undefined) {
    throw new Error(`Project not found: ${projectId}`)
  }

  const issueId = generateId<Issue>()
  const sequence = await getProjectSequence(client, projectId)
  const lastIssue = await fetchLastIssue(client, projectId)
  const descriptionRef = await uploadDescription(client, issueId, description)
  const issueData = buildIssueData(project, title, descriptionRef, sequence, priority, estimate, dueDate, lastIssue)

  await createIssueInHuly(client, issueId, projectId, issueData)
  await addLabelsConcurrently(client, projectId, issueId, labelIds)

  return finalizeIssueCreation(client, project, issueId)
}

export function createIssue({
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

  return withClient(userId, getHulyClient, async (client) => {
    const { issue, url } = await createIssueCore(
      client,
      projectId,
      title,
      description,
      priority,
      dueDate,
      labelIds,
      estimate,
    )

    log.info({ issueId: issue.id, identifier: issue.identifier, title: issue.title }, 'Issue created')

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      url,
    }
  })
}
