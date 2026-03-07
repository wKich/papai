import type { Person } from '@hcengineering/contact'
import type { Ref, Space, AttachedData, DocumentUpdate } from '@hcengineering/core'
import core from '@hcengineering/core'
import tags, { type TagElement, type TagReference } from '@hcengineering/tags'
import tracker, { type Issue, type IssueStatus } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'

const log = logger.child({ scope: 'huly:update-issue' })

type UpdateIssueParams = {
  userId: number
  issueId: string
  projectId: string
  status?: string
  assigneeId?: string
  dueDate?: string
  labelIds?: string[]
  estimate?: number
}

async function updateIssueStatus(
  client: Awaited<ReturnType<typeof getHulyClient>>,
  status: string,
  updates: DocumentUpdate<Issue>,
  userId: number,
  issueId: string,
): Promise<void> {
  const statusResult = await client.findAll<IssueStatus>(tracker.class.IssueStatus, { name: status })

  if (statusResult.length > 0 && statusResult[0] !== undefined) {
    updates.status = statusResult[0]._id
  } else {
    log.warn({ userId, issueId, requestedStatus: status }, 'Workflow state not found')
  }
}

function updateDueDate(dueDate: string, updates: DocumentUpdate<Issue>, userId: number, issueId: string): void {
  const date = new Date(dueDate)
  if (isNaN(date.getTime())) {
    log.warn({ userId, issueId, dueDate }, 'Invalid dueDate format, ignoring')
  } else {
    updates.dueDate = date.getTime()
  }
}

async function updateLabels(
  client: Awaited<ReturnType<typeof getHulyClient>>,
  issueId: string,
  projectId: string,
  labelIds: string[],
): Promise<void> {
  ensureRef<Issue>(issueId)
  ensureRef<Space>(projectId)

  const existingLabels = await client.findAll(tags.class.TagReference, { attachedTo: issueId })

  await Promise.all(
    existingLabels.map((label) => client.removeDoc(tags.class.TagReference, core.space.Space as Ref<Space>, label._id)),
  )

  await Promise.all(
    labelIds.map((labelId) => {
      ensureRef<TagElement>(labelId)
      return client.addCollection(tags.class.TagReference, projectId, issueId, tracker.class.Issue, 'labels', {
        title: '',
        color: 0,
        tag: labelId,
      } satisfies AttachedData<TagReference>)
    }),
  )
}

type HulyClient = Awaited<ReturnType<typeof getHulyClient>>

async function fetchIssue(client: HulyClient, issueId: Ref<Issue>): Promise<Issue> {
  const issue = await client.findOne(tracker.class.Issue, { _id: issueId })

  if (issue === undefined || issue === null) {
    throw new Error(`Issue not found: ${issueId}`)
  }
  return issue
}

function createUpdates(): DocumentUpdate<Issue> {
  return {}
}

async function applyIssueUpdates(
  client: HulyClient,
  issueId: Ref<Issue>,
  updates: DocumentUpdate<Issue>,
): Promise<void> {
  await client.updateDoc(tracker.class.Issue, core.space.Space as Ref<Space>, issueId, updates, false)
}

async function applyUpdates(
  client: HulyClient,
  issueId: string,
  projectId: string,
  status: string | undefined,
  assigneeId: string | undefined,
  dueDate: string | undefined,
  labelIds: string[] | undefined,
  estimate: number | undefined,
  userId: number,
): Promise<Issue> {
  ensureRef<Issue>(issueId)

  const updates = createUpdates()

  if (status !== undefined) {
    await updateIssueStatus(client, status, updates, userId, issueId)
  }

  if (assigneeId !== undefined) {
    ensureRef<Person>(assigneeId)
    updates.assignee = assigneeId
  }

  if (dueDate !== undefined) {
    updateDueDate(dueDate, updates, userId, issueId)
  }

  if (estimate !== undefined) {
    updates.estimation = estimate
    updates.remainingTime = estimate
  }

  if (Object.keys(updates).length > 0) {
    await applyIssueUpdates(client, issueId, updates)
  }

  if (labelIds !== undefined) {
    await updateLabels(client, issueId, projectId, labelIds)
  }

  return fetchIssue(client, issueId)
}

export async function updateIssue({
  userId,
  issueId,
  projectId,
  status,
  assigneeId,
  dueDate,
  labelIds,
  estimate,
}: UpdateIssueParams): Promise<{ id: string; identifier: string } | undefined> {
  log.debug({ userId, issueId, projectId, status, assigneeId, dueDate, estimate }, 'updateIssue called')

  const client = await getHulyClient(userId)

  try {
    const updatedIssue = await applyUpdates(
      client,
      issueId,
      projectId,
      status,
      assigneeId,
      dueDate,
      labelIds,
      estimate,
      userId,
    )

    log.info({ userId, issueId, identifier: updatedIssue.identifier }, 'Issue updated')

    return {
      id: updatedIssue._id,
      identifier: updatedIssue.identifier,
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), userId, issueId }, 'updateIssue failed')
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
