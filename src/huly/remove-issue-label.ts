import type { Ref, Space } from '@hcengineering/core'
import tags, { type TagElement, type TagReference } from '@hcengineering/tags'
import tracker, { type Issue } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'
import type { HulyClient } from './types.js'
import { fetchIssue } from './utils/fetchers.js'
import { buildIssueUrl } from './utils/url-builder.js'
import { withClient } from './utils/with-client.js'

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

async function findTagReference(
  client: HulyClient,
  issueId: Ref<Issue>,
  labelId: Ref<TagElement>,
): Promise<TagReference | undefined> {
  const tagRefs = await client.findAll(tags.class.TagReference, {
    attachedTo: issueId,
    tag: labelId,
  })

  return tagRefs[0]
}

async function removeTagReference(
  client: HulyClient,
  projectId: Ref<Space>,
  tagRefId: Ref<TagReference>,
  issueId: Ref<Issue>,
): Promise<void> {
  await client.removeCollection(tags.class.TagReference, projectId, tagRefId, issueId, tracker.class.Issue, 'labels')
}

export function removeIssueLabel({
  userId,
  projectId,
  issueId,
  labelId,
}: RemoveIssueLabelParams): Promise<RemoveIssueLabelResult | undefined> {
  log.debug({ userId, projectId, issueId, labelId }, 'removeIssueLabel called')

  return withClient(userId, getHulyClient, async (client) => {
    ensureRef<TagElement>(labelId)
    ensureRef<Space>(projectId)
    const issue = await fetchIssue(client, issueId)
    const tagRef = await findTagReference(client, issueId, labelId)

    if (tagRef === undefined) {
      log.warn({ userId, issueId, labelId }, 'Label not found on issue')
      return undefined
    }

    await removeTagReference(client, projectId, tagRef._id, issueId)

    log.info({ userId, issueId, labelId, identifier: issue.identifier }, 'Label removed from issue')

    const url = await buildIssueUrl(client, issue)

    return {
      id: issue._id,
      identifier: issue.identifier,
      title: issue.title,
      url,
    }
  })
}
