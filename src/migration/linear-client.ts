import { LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'linear-client' })

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
  labels: { name: string }[]
  assignee?: { email: string }
  createdAt: Date
  updatedAt: Date
}

export function createLinearClient(apiKey: string): LinearClient {
  log.debug('Creating Linear client')
  return new LinearClient({ apiKey })
}

export async function fetchUserIssues(client: LinearClient, teamId: string): Promise<LinearIssue[]> {
  log.info({ teamId }, 'Fetching user issues from Linear')

  try {
    const issues = await client.issues({
      filter: {
        team: { id: { eq: teamId } },
      },
      first: 100,
    })

    const results: LinearIssue[] = []

    for (const issue of issues.nodes) {
      const state = await issue.state
      const labels = await issue.labels()
      const assignee = await issue.assignee

      results.push({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description ?? undefined,
        state: {
          name: state?.name ?? 'Unknown',
          type: state?.type ?? 'unstarted',
        },
        priority: issue.priority,
        labels: labels.nodes.map((l) => ({ name: l.name })),
        assignee: assignee ? { email: assignee.email } : undefined,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
      })
    }

    log.info({ count: results.length }, 'Fetched issues from Linear')
    return results
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ error: message }, 'Failed to fetch Linear issues')
    throw error
  }
}
