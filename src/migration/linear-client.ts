import type { Issue } from '@linear/sdk'
import { LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'linear-client' })

export interface LinearComment {
  body: string
  authorName: string
}

export interface LinearIssue {
  id: string
  identifier: string
  title: string
  description?: string
  state: {
    name: string
    type: string
  }
  priority: number
  labels: { name: string; color: string }[]
  assignee?: { email: string }
  dueDate?: string
  estimate?: number
  comments: LinearComment[]
  createdAt: Date
  updatedAt: Date
}

export function createLinearClient(apiKey: string): LinearClient {
  log.debug('Creating Linear client')
  return new LinearClient({ apiKey })
}

async function fetchIssueDetails(issue: Issue): Promise<LinearIssue> {
  const [state, labels, assignee, comments] = await Promise.all([
    issue.state,
    issue.labels(),
    issue.assignee,
    issue.comments(),
  ])

  const commentDetails = await Promise.all(
    comments.nodes.map(async (c) => {
      const author = await c.user
      return { body: c.body, authorName: author?.name ?? 'Unknown' }
    }),
  )

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? undefined,
    state: {
      name: state?.name ?? 'Unknown',
      type: state?.type ?? 'unstarted',
    },
    priority: issue.priority,
    labels: labels.nodes.map((l) => ({ name: l.name, color: l.color ?? '#000000' })),
    assignee: assignee ? { email: assignee.email } : undefined,
    dueDate: typeof issue.dueDate === 'string' ? issue.dueDate : undefined,
    estimate: typeof issue.estimate === 'number' ? issue.estimate : undefined,
    comments: commentDetails,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  }
}

export async function fetchUserIssues(client: LinearClient, teamId: string): Promise<LinearIssue[]> {
  log.info({ teamId }, 'Fetching user issues from Linear')

  try {
    const issues = await client.issues({
      filter: { team: { id: { eq: teamId } } },
      first: 100,
    })

    const results = await Promise.all(issues.nodes.map(fetchIssueDetails))

    log.info({ count: results.length }, 'Fetched issues from Linear')
    return results
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ error: message }, 'Failed to fetch Linear issues')
    throw error
  }
}
