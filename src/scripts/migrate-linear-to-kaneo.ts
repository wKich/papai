/**
 * Migration script: Linear → self-hosted Kaneo
 *
 * For each bot user who has both Linear credentials (linear_key, linear_team_id)
 * and Kaneo credentials (kaneo_key, kaneo_base_url, kaneo_workspace_id),
 * this script:
 *
 * 1. Exports all data from the user's Linear team
 * 2. Creates matching entities in their Kaneo workspace
 * 3. Each user gets isolated scope in Kaneo (own workspace + projects)
 *
 * Usage: bun run migrate:linear [--dry-run] [--user <telegram_id>]
 */

import { Database } from 'bun:sqlite'

import { type KaneoConfig } from '../kaneo/client.js'
import { logger } from '../logger.js'
import { createTaskFromIssue, ensureColumns, ensureLabels, ensureProject, patchRelations } from './kaneo-import.js'
import {
  fetchAllIssues,
  fetchLabels,
  fetchProjects,
  fetchWorkflowStates,
  type LinearConfig,
  type LinearIssue,
  type LinearLabel,
  type LinearProject,
  type LinearState,
} from './linear-client.js'

const log = logger.child({ scope: 'migrate-l2k' })

// --- CLI args ---

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const userFlagIdx = args.indexOf('--user')
const singleUserId = userFlagIdx === -1 ? undefined : Number(args[userFlagIdx + 1])

// --- DB access ---

const DB_PATH = process.env['DB_PATH'] ?? 'papai.db'

type UserRow = { telegram_id: number; username: string | null }
type ConfigRow = { key: string; value: string }

function openDb(): Database {
  const db = new Database(DB_PATH, { readonly: true })
  db.run('PRAGMA foreign_keys=ON')
  return db
}

function getUsers(db: Database): UserRow[] {
  if (singleUserId !== undefined) {
    return db
      .query<UserRow, [number]>('SELECT telegram_id, username FROM users WHERE telegram_id = ?')
      .all(singleUserId)
  }
  return db.query<UserRow, []>('SELECT telegram_id, username FROM users').all()
}

function getUserConfig(db: Database, userId: number): Map<string, string> {
  const rows = db.query<ConfigRow, [number]>('SELECT key, value FROM user_config WHERE user_id = ?').all(userId)
  return new Map(rows.map((r) => [r.key, r.value]))
}

// --- Stats ---

export interface MigrationStats {
  labels: number
  projects: number
  columns: number
  tasks: number
  comments: number
  relations: number
  archived: number
}

function dryRunStats(
  labelCount: number,
  projectCount: number,
  stateCount: number,
  issues: Array<{ comments: { nodes: unknown[] }; relations: { nodes: unknown[] }; archivedAt: string | null }>,
): MigrationStats {
  return {
    labels: labelCount,
    projects: projectCount,
    columns: stateCount,
    tasks: issues.length,
    comments: issues.reduce((s, i) => s + i.comments.nodes.length, 0),
    relations: issues.reduce((s, i) => s + i.relations.nodes.length, 0),
    archived: issues.filter((i) => i.archivedAt !== null).length,
  }
}

// --- Per-user migration ---

function groupIssuesByProject(
  linearIssues: LinearIssue[],
  linearProjects: LinearProject[],
): { issuesByProject: Map<string | null, LinearIssue[]>; projectNameById: Map<string, LinearProject> } {
  const issuesByProject = new Map<string | null, LinearIssue[]>()
  for (const issue of linearIssues) {
    const key = issue.project?.id ?? null
    const arr = issuesByProject.get(key) ?? []
    arr.push(issue)
    issuesByProject.set(key, arr)
  }
  const projectNameById = new Map<string, LinearProject>()
  for (const p of linearProjects) {
    projectNameById.set(p.id, p)
  }
  return { issuesByProject, projectNameById }
}

async function importProjectGroup(
  kaneoConfig: KaneoConfig,
  workspaceId: string,
  projectName: string,
  projectDescription: string | undefined,
  workflowStates: LinearState[],
  issues: LinearIssue[],
  labelIdMap: Map<string, string>,
  linearIdToKaneoId: Map<string, string>,
  stats: MigrationStats,
): Promise<void> {
  const kaneoProjectId = await ensureProject(kaneoConfig, workspaceId, projectName, projectDescription)
  stats.projects++

  const stateToColumnId = await ensureColumns(kaneoConfig, kaneoProjectId, workflowStates)
  stats.columns += stateToColumnId.size

  const processIssue = async (issue: LinearIssue): Promise<void> => {
    await createTaskFromIssue(kaneoConfig, kaneoProjectId, workspaceId, issue, labelIdMap, linearIdToKaneoId)
    stats.tasks++
    stats.comments += issue.comments.nodes.length
    if (issue.archivedAt !== null) stats.archived++
  }

  await issues.reduce<Promise<void>>(async (accPromise, issue) => {
    await accPromise
    return processIssue(issue)
  }, Promise.resolve())
}

type LinearData = {
  labels: LinearLabel[]
  states: LinearState[]
  projects: LinearProject[]
  issues: LinearIssue[]
}

async function fetchLinearData(linearConfig: LinearConfig): Promise<LinearData> {
  const [labels, states, projects, issues] = await Promise.all([
    fetchLabels(linearConfig),
    fetchWorkflowStates(linearConfig),
    fetchProjects(linearConfig),
    fetchAllIssues(linearConfig),
  ])
  return { labels, states, projects, issues }
}

async function writeToKaneo(
  kaneoConfig: KaneoConfig,
  workspaceId: string,
  data: LinearData,
  stats: MigrationStats,
): Promise<void> {
  const labelIdMap = await ensureLabels(kaneoConfig, workspaceId, data.labels)
  stats.labels = labelIdMap.size

  const { issuesByProject, projectNameById } = groupIssuesByProject(data.issues, data.projects)
  const linearIdToKaneoId = new Map<string, string>()

  const processProjectGroup = async ([linearProjectId, issues]: [string | null, LinearIssue[]]): Promise<void> => {
    const lp = linearProjectId === null ? undefined : projectNameById.get(linearProjectId)
    const name = lp?.name ?? (linearProjectId === null ? 'Inbox' : 'Untitled Project')
    await importProjectGroup(
      kaneoConfig,
      workspaceId,
      name,
      lp?.description,
      data.states,
      issues,
      labelIdMap,
      linearIdToKaneoId,
      stats,
    )
  }

  await Array.from(issuesByProject).reduce<Promise<void>>(async (accPromise, projectGroup) => {
    await accPromise
    return processProjectGroup(projectGroup)
  }, Promise.resolve())

  stats.relations = await patchRelations(kaneoConfig, data.issues, linearIdToKaneoId)
}

async function migrateUser(
  userId: number,
  linearConfig: LinearConfig,
  kaneoConfig: KaneoConfig,
  workspaceId: string,
): Promise<MigrationStats> {
  log.info({ userId }, 'Starting migration')

  const data = await fetchLinearData(linearConfig)
  log.info(
    {
      userId,
      labels: data.labels.length,
      states: data.states.length,
      projects: data.projects.length,
      issues: data.issues.length,
    },
    'Linear data fetched',
  )

  if (dryRun) {
    log.info({ userId }, 'Dry run — skipping Kaneo writes')
    return dryRunStats(data.labels.length, data.projects.length, data.states.length, data.issues)
  }

  const stats: MigrationStats = { labels: 0, projects: 0, columns: 0, tasks: 0, comments: 0, relations: 0, archived: 0 }
  await writeToKaneo(kaneoConfig, workspaceId, data, stats)
  log.info({ userId, stats }, 'Migration complete')
  return stats
}

// --- Main ---

type MigrationResult = { userId: number; username: string | null; status: string; stats?: MigrationStats }

function printSummary(results: MigrationResult[]): void {
  console.log('\n=== Migration Summary ===\n')
  for (const r of results) {
    const label = r.username === null ? String(r.userId) : `@${r.username} (${r.userId})`
    console.log(`${label}: ${r.status}`)
    if (r.stats !== undefined) {
      console.log(`  Labels: ${r.stats.labels}, Projects: ${r.stats.projects}, Columns: ${r.stats.columns}`)
      console.log(`  Tasks: ${r.stats.tasks}, Comments: ${r.stats.comments}, Relations patched: ${r.stats.relations}`)
      console.log(`  Archived: ${r.stats.archived}`)
    }
  }
  console.log()
}

async function main(): Promise<void> {
  log.info({ dryRun, singleUserId }, 'Migration started')

  const db = openDb()
  const users = getUsers(db)
  log.info({ userCount: users.length }, 'Users loaded')

  const results: MigrationResult[] = []

  const processUser = async (user: UserRow): Promise<void> => {
    const config = getUserConfig(db, user.telegram_id)

    const linearKey = config.get('linear_key')
    const linearTeamId = config.get('linear_team_id')
    if (linearKey === undefined || linearTeamId === undefined) {
      log.warn({ userId: user.telegram_id }, 'Skipping — missing Linear credentials')
      results.push({ userId: user.telegram_id, username: user.username, status: 'skipped: no Linear config' })
      return
    }

    const kaneoKey = config.get('kaneo_key')
    const kaneoBaseUrl = config.get('kaneo_base_url')
    const kaneoWorkspaceId = config.get('kaneo_workspace_id')
    if (kaneoKey === undefined || kaneoBaseUrl === undefined || kaneoWorkspaceId === undefined) {
      log.warn({ userId: user.telegram_id }, 'Skipping — missing Kaneo credentials')
      results.push({ userId: user.telegram_id, username: user.username, status: 'skipped: no Kaneo config' })
      return
    }

    try {
      const stats = await migrateUser(
        user.telegram_id,
        { apiKey: linearKey, teamId: linearTeamId },
        { apiKey: kaneoKey, baseUrl: kaneoBaseUrl },
        kaneoWorkspaceId,
      )
      results.push({ userId: user.telegram_id, username: user.username, status: 'success', stats })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error({ userId: user.telegram_id, error: msg }, 'Migration failed for user')
      results.push({ userId: user.telegram_id, username: user.username, status: `failed: ${msg}` })
    }
  }

  await users.reduce<Promise<void>>(async (accPromise, user) => {
    await accPromise
    return processUser(user)
  }, Promise.resolve())

  db.close()
  printSummary(results)
}

main().catch((error: unknown) => {
  log.error({ error: error instanceof Error ? error.message : String(error) }, 'Migration script failed')
  process.exit(1)
})
