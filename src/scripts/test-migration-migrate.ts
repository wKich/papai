import type { KaneoConfig } from '../kaneo/client.js'
import { logger } from '../logger.js'
import { createTaskFromIssue, ensureColumns, ensureLabels, ensureProject, patchRelations } from './kaneo-import.js'
import {
  fetchAllIssues,
  fetchLabels,
  fetchProjects,
  fetchWorkflowStates,
  type LinearConfig,
  type LinearIssue,
  type LinearProject,
} from './linear-client.js'

const log = logger.child({ scope: 'test-migration:migrate' })

export interface MigrationResult {
  stats: Record<string, number>
  linearIdToKaneoId: Map<string, string>
  linearIssues: LinearIssue[]
  linearProjects: LinearProject[]
}

async function importProjectGroup(
  kaneoConfig: KaneoConfig,
  workspaceId: string,
  issues: LinearIssue[],
  states: Awaited<ReturnType<typeof fetchWorkflowStates>>,
  projectName: string,
  projectDescription: string | undefined,
  labelIdMap: Map<string, string>,
  linearIdToKaneoId: Map<string, string>,
  stats: Record<string, number>,
): Promise<void> {
  const kaneoProjectId = await ensureProject(kaneoConfig, workspaceId, projectName, projectDescription)
  stats['projects']!++

  const stateToColumnId = await ensureColumns(kaneoConfig, kaneoProjectId, states)
  stats['columns']! += stateToColumnId.size

  const processIssue = async (issue: LinearIssue): Promise<void> => {
    await createTaskFromIssue(kaneoConfig, kaneoProjectId, workspaceId, issue, labelIdMap, linearIdToKaneoId)
    stats['tasks']!++
    stats['comments']! += issue.comments.nodes.length
    if (issue.archivedAt !== null) stats['archived']!++
  }

  await issues.reduce<Promise<void>>(async (accPromise, issue) => {
    await accPromise
    return processIssue(issue)
  }, Promise.resolve())
}

export async function runMigration(
  linearConfig: LinearConfig,
  kaneoConfig: KaneoConfig,
  workspaceId: string,
): Promise<MigrationResult> {
  log.info('Fetching Linear data')
  const [labels, states, projects, issues] = await Promise.all([
    fetchLabels(linearConfig),
    fetchWorkflowStates(linearConfig),
    fetchProjects(linearConfig),
    fetchAllIssues(linearConfig),
  ])

  log.info(
    { labels: labels.length, states: states.length, projects: projects.length, issues: issues.length },
    'Linear data fetched',
  )

  const stats: Record<string, number> = {
    labels: 0,
    projects: 0,
    columns: 0,
    tasks: 0,
    comments: 0,
    relations: 0,
    archived: 0,
  }

  const labelIdMap = await ensureLabels(kaneoConfig, workspaceId, labels)
  stats['labels'] = labelIdMap.size

  const issuesByProject = new Map<string | null, LinearIssue[]>()
  for (const issue of issues) {
    const key = issue.project?.id ?? null
    const arr = issuesByProject.get(key) ?? []
    arr.push(issue)
    issuesByProject.set(key, arr)
  }

  const projectNameById = new Map(projects.map((p) => [p.id, p]))
  const linearIdToKaneoId = new Map<string, string>()

  const processProjectGroup = async ([linearProjectId, projectIssues]: [
    string | null,
    LinearIssue[],
  ]): Promise<void> => {
    const lp = linearProjectId === null ? undefined : projectNameById.get(linearProjectId)
    const name = lp?.name ?? (linearProjectId === null ? 'Inbox' : 'Untitled Project')
    await importProjectGroup(
      kaneoConfig,
      workspaceId,
      projectIssues,
      states,
      name,
      lp?.description,
      labelIdMap,
      linearIdToKaneoId,
      stats,
    )
  }

  await Array.from(issuesByProject).reduce<Promise<void>>(async (accPromise, projectGroup) => {
    await accPromise
    return processProjectGroup(projectGroup)
  }, Promise.resolve())

  stats['relations'] = await patchRelations(kaneoConfig, issues, linearIdToKaneoId)

  return { stats, linearIdToKaneoId, linearIssues: issues, linearProjects: projects }
}
