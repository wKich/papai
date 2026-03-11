import path from 'node:path'

import { setConfig } from './config.js'
import { DB_PATH, closeDb, getDb, initDb } from './db/index.js'
import { clearHistory } from './history.js'
import { type KaneoConfig } from './kaneo/client.js'
import { provisionKaneoUser } from './kaneo/provision.js'
import { logger } from './logger.js'
import { clearFacts, clearSummary } from './memory.js'
import type {
  ConfigRow,
  LinearData,
  MigrationOptions,
  MigrationStats,
  MigrationUserResult,
  ProgressCallback,
  ResolvedKaneoConfig,
  UserRow,
} from './migration-types.js'
import {
  createTaskFromIssue,
  ensureArchivedLabel,
  ensureColumns,
  ensureLabels,
  ensureProject,
  patchRelations,
} from './scripts/kaneo-import.js'
import {
  fetchAllIssues,
  fetchLabels,
  fetchProjects,
  fetchWorkflowStates,
  type LinearConfig,
} from './scripts/linear-client.js'
import { processSequentially, processWithAccumulator } from './scripts/queue.js'
import { getKaneoWorkspace, setKaneoWorkspace } from './users.js'

const log = logger.child({ scope: 'migration' })
let lastBackupPath: string | undefined

export const getLastBackupPath = (): string | undefined => lastBackupPath
export type { MigrationStats, MigrationUserResult, MigrationOptions, ProgressCallback }

export function createBackup(): string {
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const dir = path.dirname(DB_PATH)
  const backupPath = path.join(dir, `papai-backup-${timestamp}.db`)
  log.info({ backupPath }, 'Creating database backup')
  getDb().run(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`)
  lastBackupPath = backupPath
  log.info({ backupPath }, 'Database backup created')
  return backupPath
}

export async function restoreBackup(backupPath: string): Promise<void> {
  log.info({ backupPath }, 'Restoring database from backup')
  closeDb()
  await Bun.write(DB_PATH, Bun.file(backupPath))
  initDb()
  log.info({ backupPath }, 'Database restored and reinitialized')
}

function getUsers(singleUserId: number | undefined): UserRow[] {
  if (singleUserId !== undefined) {
    return getDb()
      .query<UserRow, [number]>('SELECT telegram_id, username FROM users WHERE telegram_id = ?')
      .all(singleUserId)
  }
  return getDb().query<UserRow, []>('SELECT telegram_id, username FROM users').all()
}

function getUserConfig(userId: number): Map<string, string> {
  const rows = getDb().query<ConfigRow, [number]>('SELECT key, value FROM user_config WHERE user_id = ?').all(userId)
  return new Map(rows.map((r) => [r.key, r.value]))
}

function clearUserHistoryInDb(userId: number): void {
  clearHistory(userId)
  clearSummary(userId)
  clearFacts(userId)
  log.info({ userId }, 'Conversation history and memory cleared')
}

function deleteLinearConfig(userId: number): void {
  getDb().run("DELETE FROM user_config WHERE user_id = ? AND key IN ('linear_key', 'linear_team_id')", [userId])
  log.info({ userId }, 'Linear config removed after migration')
}

function getUserLabel(user: UserRow): string {
  return user.username === null ? String(user.telegram_id) : `@${user.username}`
}

function buildSkipResult(user: UserRow, reason: string): MigrationUserResult {
  return { userId: user.telegram_id, username: user.username, status: `skipped: ${reason}` }
}

async function resolveKaneoConfig(
  user: UserRow,
  config: Map<string, string>,
  opts: MigrationOptions,
): Promise<ResolvedKaneoConfig | null> {
  const kaneoKey = config.get('kaneo_key')
  const kaneoWorkspaceId = getKaneoWorkspace(user.telegram_id)
  const kaneoBaseUrl = opts.kaneoUrl
  if (kaneoKey !== undefined && kaneoWorkspaceId !== null && kaneoBaseUrl !== undefined) {
    return { kaneoKey, kaneoBaseUrl, kaneoWorkspaceId }
  }
  if (opts.dryRun === true || kaneoBaseUrl === undefined) return null
  const prov = await provisionKaneoUser(kaneoBaseUrl, kaneoBaseUrl, user.telegram_id, user.username)
  setConfig(user.telegram_id, 'kaneo_key', prov.kaneoKey)
  setKaneoWorkspace(user.telegram_id, prov.workspaceId)
  return {
    kaneoKey: prov.kaneoKey,
    kaneoBaseUrl,
    kaneoWorkspaceId: prov.workspaceId,
    kaneoEmail: prov.email,
    kaneoPassword: prov.password,
  }
}

async function fetchLinearData(config: LinearConfig): Promise<LinearData> {
  const [labels, states, projects, issues] = await Promise.all([
    fetchLabels(config),
    fetchWorkflowStates(config),
    fetchProjects(config),
    fetchAllIssues(config),
  ])
  return { labels, states, projects, issues }
}

async function importProjectGroup(
  kaneoConfig: KaneoConfig,
  workspaceId: string,
  projectName: string,
  projectDescription: string | undefined,
  workflowStates: LinearData['states'],
  issues: LinearData['issues'],
  labelIdMap: Map<string, string>,
  linearIdToKaneoId: Map<string, string>,
  stats: MigrationStats,
): Promise<void> {
  const kaneoProjectId = await ensureProject(kaneoConfig, workspaceId, projectName, projectDescription)
  stats.projects++
  const { newCount } = await ensureColumns(kaneoConfig, kaneoProjectId, workflowStates)
  stats.columns += newCount
  const hasArchived = issues.some((i) => i.archivedAt !== null)
  const archivedLabel = hasArchived ? await ensureArchivedLabel(kaneoConfig, workspaceId) : undefined
  await processWithAccumulator(
    issues,
    { tasks: stats.tasks, comments: stats.comments, archived: stats.archived },
    async (issue, acc) => {
      await createTaskFromIssue(
        kaneoConfig,
        kaneoProjectId,
        workspaceId,
        issue,
        labelIdMap,
        linearIdToKaneoId,
        archivedLabel,
      )
      return {
        tasks: acc.tasks + 1,
        comments: acc.comments + issue.comments.nodes.length,
        archived: issue.archivedAt === null ? acc.archived : acc.archived + 1,
      }
    },
  ).then((result) => {
    stats.tasks = result.tasks
    stats.comments = result.comments
    stats.archived = result.archived
  })
}

async function writeToKaneo(
  kaneoConfig: KaneoConfig,
  workspaceId: string,
  data: LinearData,
  stats: MigrationStats,
): Promise<void> {
  const labelIdMap = await ensureLabels(kaneoConfig, workspaceId, data.labels)
  stats.labels = labelIdMap.size
  const issuesByProject = new Map<string | null, LinearData['issues']>()
  for (const issue of data.issues) {
    const key = issue.project?.id ?? null
    const arr = issuesByProject.get(key) ?? []
    arr.push(issue)
    issuesByProject.set(key, arr)
  }
  const projectNameById = new Map(data.projects.map((p) => [p.id, p]))
  const linearIdToKaneoId = new Map<string, string>()
  const projectGroups = Array.from(issuesByProject.entries())
  await processSequentially(projectGroups, async ([id, issues]) => {
    const lp = id === null ? undefined : projectNameById.get(id)
    const name = lp?.name ?? (id === null ? 'Inbox' : 'Untitled Project')
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
  })
  stats.relations = await patchRelations(kaneoConfig, data.issues, linearIdToKaneoId)
}

async function migrateUserData(
  userId: number,
  linearConfig: LinearConfig,
  kaneoConfig: KaneoConfig,
  workspaceId: string,
  dryRun: boolean,
): Promise<MigrationStats> {
  const data = await fetchLinearData(linearConfig)
  log.info({ userId, labels: data.labels.length, issues: data.issues.length }, 'Linear data fetched')
  if (dryRun) {
    return {
      labels: data.labels.length,
      projects: data.projects.length,
      columns: data.states.length,
      tasks: data.issues.length,
      comments: data.issues.reduce((s, i) => s + i.comments.nodes.length, 0),
      relations: data.issues.reduce((s, i) => s + i.relations.nodes.length, 0),
      archived: data.issues.filter((i) => i.archivedAt !== null).length,
    }
  }
  const stats: MigrationStats = { labels: 0, projects: 0, columns: 0, tasks: 0, comments: 0, relations: 0, archived: 0 }
  await writeToKaneo(kaneoConfig, workspaceId, data, stats)
  return stats
}

async function tryMigrateUser(
  user: UserRow,
  config: Map<string, string>,
  opts: MigrationOptions,
): Promise<MigrationUserResult> {
  const linearKey = config.get('linear_key')
  const linearTeamId = config.get('linear_team_id')
  if (linearKey === undefined || linearTeamId === undefined) {
    return buildSkipResult(user, 'no Linear config')
  }
  const kc = await resolveKaneoConfig(user, config, opts)
  if (kc === null) return buildSkipResult(user, 'no Kaneo config')
  try {
    const stats = await migrateUserData(
      user.telegram_id,
      { apiKey: linearKey, teamId: linearTeamId },
      { apiKey: kc.kaneoKey, baseUrl: kc.kaneoBaseUrl },
      kc.kaneoWorkspaceId,
      opts.dryRun ?? false,
    )
    if ((opts.clearHistory ?? false) && !(opts.dryRun ?? false)) {
      clearUserHistoryInDb(user.telegram_id)
    }
    if (!(opts.dryRun ?? false)) {
      deleteLinearConfig(user.telegram_id)
    }
    log.info({ userId: user.telegram_id, stats }, 'User migration complete')
    return {
      userId: user.telegram_id,
      username: user.username,
      status: 'success',
      stats,
      kaneoEmail: kc.kaneoEmail,
      kaneoPassword: kc.kaneoPassword,
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error({ userId: user.telegram_id, error: msg }, 'User migration failed')
    return { userId: user.telegram_id, username: user.username, status: `failed: ${msg}` }
  }
}

async function processSingleUser(
  user: UserRow,
  opts: MigrationOptions,
  onProgress: ProgressCallback | undefined,
): Promise<MigrationUserResult> {
  const label = getUserLabel(user)
  const config = getUserConfig(user.telegram_id)
  const result = await tryMigrateUser(user, config, opts)
  if (onProgress !== undefined) {
    if (result.status === 'success' && result.stats !== undefined) {
      const s = result.stats
      await onProgress(`✓ ${label}: ${s.tasks} tasks, ${s.projects} projects, ${s.comments} comments`)
    } else if (result.status.startsWith('skipped')) {
      await onProgress(`~ ${label}: ${result.status}`)
    } else {
      await onProgress(`✗ ${label}: ${result.status}`)
    }
  }
  return result
}

export async function runMigration(
  opts: MigrationOptions = {},
  onProgress?: ProgressCallback,
): Promise<MigrationUserResult[]> {
  log.info(
    { dryRun: opts.dryRun, clearHistory: opts.clearHistory, singleUserId: opts.singleUserId },
    'runMigration called',
  )
  const users = getUsers(opts.singleUserId)
  log.info({ userCount: users.length }, 'Users loaded for migration')
  const results = await Promise.all(users.map((user) => processSingleUser(user, opts, onProgress)))
  return results
}
