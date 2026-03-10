import { logger } from '../logger.js'

const log = logger.child({ scope: 'linear-client' })

export type LinearConfig = {
  apiKey: string
  teamId: string
}

type GraphQLResponse<T> = {
  data?: T
  errors?: Array<{ message: string }>
}

async function linearQuery<T>(apiKey: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    throw new Error(`Linear API returned ${response.status}: ${await response.text()}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- response.json() returns unknown, generic cast is intentional
  const json = (await response.json()) as GraphQLResponse<T>
  if (json.errors !== undefined && json.errors.length > 0) {
    throw new Error(`Linear GraphQL error: ${json.errors.map((e) => e.message).join(', ')}`)
  }
  if (json.data === undefined) {
    throw new Error('Linear GraphQL returned no data')
  }
  return json.data
}

// --- Types ---

export type LinearLabel = {
  id: string
  name: string
  color: string
}

export type LinearState = {
  id: string
  name: string
  color: string
  type: string
  position: number
}

export type LinearProject = {
  id: string
  name: string
  description: string
  state: string
}

export type LinearComment = {
  id: string
  body: string
  createdAt: string
}

export type LinearRelation = {
  id: string
  type: string
  relatedIssue: { id: string; identifier: string }
}

export type LinearIssue = {
  id: string
  identifier: string
  title: string
  description: string | null
  priority: number
  dueDate: string | null
  archivedAt: string | null
  state: { id: string; name: string }
  labels: { nodes: LinearLabel[] }
  comments: { nodes: LinearComment[] }
  relations: { nodes: LinearRelation[] }
  project: { id: string; name: string } | null
  parent: { id: string; identifier: string } | null
}

// --- Fetchers ---

export async function fetchLabels(config: LinearConfig): Promise<LinearLabel[]> {
  log.info({ teamId: config.teamId }, 'Fetching Linear labels')

  type Data = { team: { labels: { nodes: LinearLabel[] } } }
  const data = await linearQuery<Data>(
    config.apiKey,
    `
    query($teamId: String!) {
      team(id: $teamId) {
        labels(first: 250) {
          nodes { id name color }
        }
      }
    }
  `,
    { teamId: config.teamId },
  )

  const labels = data.team.labels.nodes
  log.info({ count: labels.length }, 'Labels fetched')
  return labels
}

export async function fetchWorkflowStates(config: LinearConfig): Promise<LinearState[]> {
  log.info({ teamId: config.teamId }, 'Fetching Linear workflow states')

  type Data = { team: { states: { nodes: LinearState[] } } }
  const data = await linearQuery<Data>(
    config.apiKey,
    `
    query($teamId: String!) {
      team(id: $teamId) {
        states(first: 50) {
          nodes { id name color type position }
        }
      }
    }
  `,
    { teamId: config.teamId },
  )

  const states = data.team.states.nodes.sort((a, b) => a.position - b.position)
  log.info({ count: states.length }, 'Workflow states fetched')
  return states
}

export async function fetchProjects(config: LinearConfig): Promise<LinearProject[]> {
  log.info({ teamId: config.teamId }, 'Fetching Linear projects')

  type Data = { team: { projects: { nodes: LinearProject[] } } }
  const data = await linearQuery<Data>(
    config.apiKey,
    `
    query($teamId: String!) {
      team(id: $teamId) {
        projects(first: 100) {
          nodes { id name description state }
        }
      }
    }
  `,
    { teamId: config.teamId },
  )

  const projects = data.team.projects.nodes
  log.info({ count: projects.length }, 'Projects fetched')
  return projects
}

export async function fetchAllIssues(config: LinearConfig): Promise<LinearIssue[]> {
  log.info({ teamId: config.teamId }, 'Fetching Linear issues')

  const allIssues: LinearIssue[] = []
  let cursor: string | undefined

  const query = `
    query($teamId: String!, $cursor: String) {
      team(id: $teamId) {
        issues(first: 50, after: $cursor, includeArchived: true) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id identifier title description priority dueDate archivedAt
            state { id name }
            labels(first: 50) { nodes { id name color } }
            comments(first: 100) { nodes { id body createdAt } }
            relations(first: 50) {
              nodes {
                id type
                relatedIssue { id identifier }
              }
            }
            project { id name }
            parent { id identifier }
          }
        }
      }
    }
  `

  while (true) {
    type PageInfo = { hasNextPage: boolean; endCursor: string | null }
    type Data = { team: { issues: { pageInfo: PageInfo; nodes: LinearIssue[] } } }

    // eslint-disable-next-line no-await-in-loop
    const data = await linearQuery<Data>(config.apiKey, query, { teamId: config.teamId, cursor })
    const { nodes, pageInfo } = data.team.issues

    allIssues.push(...nodes)
    log.debug({ fetched: nodes.length, total: allIssues.length }, 'Issues page fetched')

    if (!pageInfo.hasNextPage || pageInfo.endCursor === null) break
    cursor = pageInfo.endCursor
  }

  log.info({ count: allIssues.length }, 'All issues fetched')
  return allIssues
}
