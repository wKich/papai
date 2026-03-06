import core from '@hcengineering/core'
import tags, { type TagReference } from '@hcengineering/tags'
import tracker, { type Issue } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

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
    // First, fetch the existing issue to verify it exists
    const existingIssue = (await client.findOne(tracker.class.Issue, {
      _id: issueId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as Issue | undefined

    if (!existingIssue) {
      throw new Error(`Issue not found: ${issueId}`)
    }

    // Build update object
    const updates: Record<string, unknown> = {}

    // Update status
    if (status !== undefined) {
      // Find the status by name
      const statusResult = (await client.findAll(tracker.class.IssueStatus, {
        name: status,
      } as unknown as Parameters<typeof client.findAll>[1])) as unknown as Array<{ _id: string }>

      if (statusResult.length > 0 && statusResult[0] !== undefined) {
        updates['status'] = statusResult[0]._id
      } else {
        log.warn({ userId, issueId, requestedStatus: status }, 'Workflow state not found')
      }
    }

    // Update assignee
    if (assigneeId !== undefined) {
      updates['assignee'] = assigneeId
    }

    // Update due date
    if (dueDate !== undefined) {
      const date = new Date(dueDate)
      if (!isNaN(date.getTime())) {
        updates['dueDate'] = date.getTime()
      } else {
        log.warn({ userId, issueId, dueDate }, 'Invalid dueDate format, ignoring')
      }
    }

    // Update estimate
    if (estimate !== undefined) {
      updates['estimation'] = estimate
      updates['remainingTime'] = estimate
    }

    // Apply updates if any
    if (Object.keys(updates).length > 0) {
      await client.updateDoc(
        tracker.class.Issue,
        core.space.Space as unknown as Parameters<typeof client.updateDoc>[1],
        issueId as unknown as Parameters<typeof client.updateDoc>[2],
        updates as unknown as Parameters<typeof client.updateDoc>[3],
        false,
      )
    }

    // Handle labels separately - remove old and add new
    if (labelIds !== undefined) {
      // Fetch existing labels
      const existingLabels = (await client.findAll(tags.class.TagReference, {
        attachedTo: issueId as unknown as Parameters<typeof client.findAll>[1]['attachedTo'],
      } as unknown as Parameters<typeof client.findAll>[1])) as unknown as TagReference[]

      // Remove existing labels
      for (const label of existingLabels) {
        await client.removeDoc(
          tags.class.TagReference,
          core.space.Space as unknown as Parameters<typeof client.removeDoc>[1],
          (label as { _id: string })._id as unknown as Parameters<typeof client.removeDoc>[2],
        )
      }

      // Add new labels
      for (const labelId of labelIds) {
        await client.addCollection(
          tags.class.TagReference,
          projectId as unknown as Parameters<typeof client.addCollection>[1],
          issueId as unknown as Parameters<typeof client.addCollection>[2],
          tracker.class.Issue,
          'labels',
          {
            title: '',
            color: 0,
            tag: labelId,
          } as unknown as Parameters<typeof client.addCollection>[5],
        )
      }
    }

    // Fetch updated issue
    const updatedIssue = (await client.findOne(tracker.class.Issue, {
      _id: issueId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as Issue | undefined

    if (!updatedIssue) {
      throw new Error('Issue was not found after update')
    }

    log.info(
      { userId, issueId, identifier: updatedIssue.identifier, updatedFields: Object.keys(updates) },
      'Issue updated',
    )

    return {
      id: updatedIssue._id as string,
      identifier: updatedIssue.identifier,
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), userId, issueId }, 'updateIssue failed')
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
