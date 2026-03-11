import { type ZodType, z } from 'zod'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'linear-client' })

export type LinearConfig = {
  apiKey: string
  teamId: string
}

const GraphQLErrorSchema = z.object({
  message: z.string(),
})

const GraphQLResponseSchema = <T extends ZodType>(
  dataSchema: T,
): z.ZodObject<{ data: z.ZodOptional<T>; errors: z.ZodOptional<z.ZodArray<typeof GraphQLErrorSchema>> }> =>
  z.object({
    data: dataSchema.optional(),
    errors: z.array(GraphQLErrorSchema).optional(),
  })

async function linearQuery<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown> | undefined,
  dataSchema: ZodType<T>,
): Promise<T> {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    throw new Error(`Linear API returned ${response.status}: ${await response.text()}`)
  }

  const responseSchema = GraphQLResponseSchema(dataSchema)
  const rawJson: unknown = await response.json()
  const parsed = responseSchema.safeParse(rawJson)

  if (!parsed.success) {
    throw new Error(`Linear GraphQL returned invalid response: ${JSON.stringify(parsed.error.issues)}`)
  }

  const json = parsed.data
  if (json.errors !== undefined && json.errors.length > 0) {
    throw new Error(`Linear GraphQL error: ${json.errors.map((e) => e.message).join(', ')}`)
  }
  if (json.data === undefined) {
    throw new Error('Linear GraphQL returned no data')
  }
  return json.data
}

// --- Types & Schemas ---

export const LinearLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
})

export type LinearLabel = z.infer<typeof LinearLabelSchema>

export const LinearStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  type: z.string(),
  position: z.number(),
})

export type LinearState = z.infer<typeof LinearStateSchema>

export const LinearProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  state: z.string(),
})

export type LinearProject = z.infer<typeof LinearProjectSchema>

export const LinearCommentSchema = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.string(),
})

export type LinearComment = z.infer<typeof LinearCommentSchema>

export const LinearRelationSchema = z.object({
  id: z.string(),
  type: z.string(),
  relatedIssue: z.object({
    id: z.string(),
    identifier: z.string(),
  }),
})

export type LinearRelation = z.infer<typeof LinearRelationSchema>

const LinearLabelNodeSchema = z.object({ nodes: z.array(LinearLabelSchema) })
const LinearCommentNodeSchema = z.object({ nodes: z.array(LinearCommentSchema) })
const LinearRelationNodeSchema = z.object({ nodes: z.array(LinearRelationSchema) })
const LinearStateInfoSchema = z.object({ id: z.string(), name: z.string() })
const LinearProjectInfoSchema = z.object({ id: z.string(), name: z.string() })
const LinearParentInfoSchema = z.object({ id: z.string(), identifier: z.string() })

export const LinearIssueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.number(),
  dueDate: z.string().nullable(),
  archivedAt: z.string().nullable(),
  state: LinearStateInfoSchema,
  labels: LinearLabelNodeSchema,
  comments: LinearCommentNodeSchema,
  relations: LinearRelationNodeSchema,
  project: LinearProjectInfoSchema.nullable(),
  parent: LinearParentInfoSchema.nullable(),
})

export type LinearIssue = z.infer<typeof LinearIssueSchema>

// --- Fetchers ---

const PageInfoSchema = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable(),
})

const LabelsDataSchema = z.object({
  team: z.object({
    labels: z.object({
      pageInfo: PageInfoSchema,
      nodes: z.array(LinearLabelSchema),
    }),
  }),
})

export async function fetchLabels(config: LinearConfig): Promise<LinearLabel[]> {
  log.info({ teamId: config.teamId }, 'Fetching Linear labels')
  const query = `
    query($teamId: String!, $cursor: String) {
      team(id: $teamId) {
        labels(first: 250, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { id name color }
        }
      }
    }
  `
  const accumulate = async (acc: LinearLabel[], cursor: string | undefined): Promise<LinearLabel[]> => {
    const data = await linearQuery(config.apiKey, query, { teamId: config.teamId, cursor }, LabelsDataSchema)
    const { nodes, pageInfo } = data.team.labels
    const updated = [...acc, ...nodes]
    if (!pageInfo.hasNextPage || pageInfo.endCursor === null) return updated
    return accumulate(updated, pageInfo.endCursor)
  }
  const allLabels = await accumulate([], undefined)
  log.info({ count: allLabels.length }, 'Labels fetched')
  return allLabels
}

const StatesDataSchema = z.object({
  team: z.object({
    states: z.object({
      pageInfo: PageInfoSchema,
      nodes: z.array(LinearStateSchema),
    }),
  }),
})

export async function fetchWorkflowStates(config: LinearConfig): Promise<LinearState[]> {
  log.info({ teamId: config.teamId }, 'Fetching Linear workflow states')
  const query = `
    query($teamId: String!, $cursor: String) {
      team(id: $teamId) {
        states(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { id name color type position }
        }
      }
    }
  `
  const accumulate = async (acc: LinearState[], cursor: string | undefined): Promise<LinearState[]> => {
    const data = await linearQuery(config.apiKey, query, { teamId: config.teamId, cursor }, StatesDataSchema)
    const { nodes, pageInfo } = data.team.states
    const updated = [...acc, ...nodes]
    if (!pageInfo.hasNextPage || pageInfo.endCursor === null) return updated
    return accumulate(updated, pageInfo.endCursor)
  }
  const allStates = await accumulate([], undefined)
  log.info({ count: allStates.length }, 'Workflow states fetched')
  return allStates.sort((a, b) => a.position - b.position)
}

const ProjectsDataSchema = z.object({
  team: z.object({
    projects: z.object({
      pageInfo: PageInfoSchema,
      nodes: z.array(LinearProjectSchema),
    }),
  }),
})

export async function fetchProjects(config: LinearConfig): Promise<LinearProject[]> {
  log.info({ teamId: config.teamId }, 'Fetching Linear projects')
  const query = `
    query($teamId: String!, $cursor: String) {
      team(id: $teamId) {
        projects(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { id name description state }
        }
      }
    }
  `
  const accumulate = async (acc: LinearProject[], cursor: string | undefined): Promise<LinearProject[]> => {
    const data = await linearQuery(config.apiKey, query, { teamId: config.teamId, cursor }, ProjectsDataSchema)
    const { nodes, pageInfo } = data.team.projects
    const updated = [...acc, ...nodes]
    if (!pageInfo.hasNextPage || pageInfo.endCursor === null) return updated
    return accumulate(updated, pageInfo.endCursor)
  }
  const allProjects = await accumulate([], undefined)
  log.info({ count: allProjects.length }, 'Projects fetched')
  return allProjects
}

const IssuesDataSchema = z.object({
  team: z.object({
    issues: z.object({
      pageInfo: PageInfoSchema,
      nodes: z.array(LinearIssueSchema),
    }),
  }),
})

async function fetchIssuesPage(
  config: LinearConfig,
  cursor: string | undefined,
): Promise<{ nodes: LinearIssue[]; hasNextPage: boolean; endCursor: string | null }> {
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
  const data = await linearQuery(config.apiKey, query, { teamId: config.teamId, cursor }, IssuesDataSchema)
  return {
    nodes: data.team.issues.nodes,
    hasNextPage: data.team.issues.pageInfo.hasNextPage,
    endCursor: data.team.issues.pageInfo.endCursor,
  }
}

export async function fetchAllIssues(config: LinearConfig): Promise<LinearIssue[]> {
  log.info({ teamId: config.teamId }, 'Fetching Linear issues')

  const accumulateIssues = async (accumulator: LinearIssue[], cursor: string | undefined): Promise<LinearIssue[]> => {
    const { nodes, hasNextPage, endCursor } = await fetchIssuesPage(config, cursor)
    const updatedAccumulator = [...accumulator, ...nodes]
    log.debug({ fetched: nodes.length, total: updatedAccumulator.length }, 'Issues page fetched')

    if (!hasNextPage || endCursor === null) {
      return updatedAccumulator
    }
    return accumulateIssues(updatedAccumulator, endCursor)
  }

  const allIssues = await accumulateIssues([], undefined)
  log.info({ count: allIssues.length }, 'All issues fetched')
  return allIssues
}
