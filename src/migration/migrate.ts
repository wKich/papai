import { getDb } from '../db/index.js'
import { isIssueMigrated, recordMigratedIssue } from '../db/migrated-issues.js'
import { getMigrationStatus, setMigrationStatus, isMigrationComplete } from '../db/migration-status.js'
import { createIssue } from '../huly/create-issue.js'
import { getHulyClient } from '../huly/huly-client.js'
import { getOrCreateUserProject } from '../huly/project-utils.js'
import type { HulyClient } from '../huly/types.js'
import { withClient } from '../huly/utils/with-client.js'
import { logger } from '../logger.js'
import { migrateComments } from './comment-migration.js'
import { ensureHulyCredentials } from './huly-account.js'
import { mapLinearIssueToHuly } from './issue-mapper.js'
import { buildLabelCache } from './label-sync.js'
import { createLinearClient, fetchUserIssues, type LinearIssue } from './linear-client.js'

const log = logger.child({ scope: 'migration' })

function getMigrationConfigValue(userId: number, key: string): string | null {
  const row = getDb()
    .query<{ value: string }, [number, string]>('SELECT value FROM user_config WHERE user_id = ? AND key = ?')
    .get(userId, key)
  return row?.value ?? null
}

export interface MigrationResult {
  success: boolean
  migratedCount: number
  errors: string[]
}
interface UserMigrationResult {
  count: number
  error?: string
}
interface MigrationIssueResult {
  success: boolean
  issueId?: string
  skipped?: boolean
  error?: string
}

export async function runLinearToHulyMigration(): Promise<MigrationResult> {
  log.info('Starting Linear to Huly migration')

  const preflightCheck = runPreflightChecks()
  if (preflightCheck !== undefined) {
    return preflightCheck
  }

  setMigrationStatus('linear_to_huly', 'in_progress')

  const errors: string[] = []
  let migratedCount = 0

  try {
    const users = getUsersWithLinearCredentials()
    log.info({ userCount: users.length }, 'Found users with Linear credentials')

    for (const { user_id: userId } of users) {
      // oxlint-disable-next-line no-await-in-loop
      const userResult = await migrateUserWithFaultTolerance(userId)
      migratedCount += userResult.count
      if (userResult.error !== undefined) {
        errors.push(`User ${userId}: ${userResult.error}`)
      }
    }

    return finalizeMigration(migratedCount, errors)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setMigrationStatus('linear_to_huly', 'failed', message)
    log.error({ error: message }, 'Migration failed')
    return { success: false, migratedCount, errors: [message] }
  }
}

function runPreflightChecks(): MigrationResult | undefined {
  if (isMigrationComplete('linear_to_huly')) {
    log.info('Migration already completed, skipping')
    return { success: true, migratedCount: 0, errors: [] }
  }

  const currentStatus = getMigrationStatus('linear_to_huly')
  if (currentStatus === 'in_progress') {
    log.warn('Migration already in progress, skipping to prevent conflicts')
    return { success: false, migratedCount: 0, errors: ['Migration already in progress'] }
  }

  return undefined
}

function getUsersWithLinearCredentials(): Array<{ user_id: number }> {
  return getDb()
    .query<{ user_id: number }, []>(
      `SELECT DISTINCT user_id FROM user_config WHERE key IN ('linear_key', 'linear_team_id')`,
    )
    .all()
}

async function migrateUserWithFaultTolerance(userId: number): Promise<UserMigrationResult> {
  try {
    return await migrateUserIssues(userId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ userId, error: message }, 'Failed to migrate user issues')
    return { count: 0, error: message }
  }
}

function finalizeMigration(migratedCount: number, errors: string[]): MigrationResult {
  const success = errors.length === 0
  if (success) {
    setMigrationStatus('linear_to_huly', 'completed')
    log.info({ migratedCount }, 'Migration completed successfully')
  } else {
    setMigrationStatus('linear_to_huly', 'failed', errors.join('; '))
    log.error({ errorCount: errors.length }, 'Migration completed with errors')
  }
  return { success, migratedCount, errors }
}

async function migrateUserIssues(userId: number): Promise<UserMigrationResult> {
  log.info({ userId }, 'Migrating user issues')

  const linearKey = getMigrationConfigValue(userId, 'linear_key')
  const linearTeamId = getMigrationConfigValue(userId, 'linear_team_id')
  if (linearKey === null || linearTeamId === null) {
    return { count: 0, error: 'Missing Linear credentials' }
  }

  // Ensure the user has a Huly account (creates one if absent)
  await ensureHulyCredentials(userId)

  const linearIssues = await fetchIssuesForUser(linearKey, linearTeamId)
  if (linearIssues.length === 0) {
    log.info({ userId }, 'No Linear issues to migrate')
    return { count: 0 }
  }

  return migrateIssuesWithClient(userId, linearIssues)
}

function fetchIssuesForUser(linearKey: string, linearTeamId: string): Promise<LinearIssue[]> {
  const linearClient = createLinearClient(linearKey)
  return fetchUserIssues(linearClient, linearTeamId)
}

async function migrateIssuesWithClient(userId: number, linearIssues: LinearIssue[]): Promise<UserMigrationResult> {
  let migratedCount = 0

  try {
    await withClient(userId, getHulyClient, async (hulyClient) => {
      const project = await getOrCreateUserProject(hulyClient, userId)
      const projectId = project._id
      const labelCache = await buildLabelCache(hulyClient, linearIssues)

      for (const linearIssue of linearIssues) {
        // oxlint-disable-next-line no-await-in-loop
        const result = await migrateSingleIssueWithFaultTolerance(
          hulyClient,
          userId,
          linearIssue,
          projectId,
          labelCache,
        )
        if (result.success) migratedCount++
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { count: migratedCount, error: message }
  }

  log.info({ userId, migratedCount, totalCount: linearIssues.length }, 'User migration complete')
  return { count: migratedCount }
}

async function migrateSingleIssueWithFaultTolerance(
  hulyClient: HulyClient,
  userId: number,
  linearIssue: LinearIssue,
  projectId: string,
  labelCache: Map<string, string>,
): Promise<MigrationIssueResult> {
  try {
    return await migrateSingleIssue(hulyClient, userId, linearIssue, projectId, labelCache)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ linearId: linearIssue.id, error: message }, 'Failed to migrate issue')
    return { success: false, error: message }
  }
}

async function migrateSingleIssue(
  hulyClient: HulyClient,
  userId: number,
  linearIssue: LinearIssue,
  projectId: string,
  labelCache: Map<string, string>,
): Promise<MigrationIssueResult> {
  log.debug({ linearId: linearIssue.id, userId }, 'Migrating single issue')

  if (isIssueMigrated(userId, linearIssue.id)) {
    log.info({ linearId: linearIssue.id, userId }, 'Issue already migrated, skipping')
    return { success: false, skipped: true }
  }

  const hulyData = mapLinearIssueToHuly(linearIssue, projectId)
  const priority = mapPriorityToNumber(hulyData.priority)
  const labelIds = hulyData.labels.map((l) => labelCache.get(l.name)).filter((id): id is string => id !== undefined)

  try {
    const result = await createIssue({
      userId,
      title: hulyData.title,
      description: hulyData.description,
      priority,
      projectId: hulyData.project,
      dueDate: hulyData.dueDate,
      estimate: hulyData.estimate,
      labelIds: labelIds.length > 0 ? labelIds : undefined,
    })

    if (result.id === undefined || result.id === null || result.id === '') {
      log.error({ linearId: linearIssue.id }, 'createIssue returned empty ID')
      return { success: false, error: 'Failed to create issue: empty ID returned' }
    }

    recordMigratedIssue(userId, linearIssue.id, result.id)
    log.info({ linearId: linearIssue.id, hulyId: result.id }, 'Successfully migrated issue')

    await migrateComments(hulyClient, projectId, result.id, linearIssue.comments)

    return { success: true, issueId: result.id }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ linearId: linearIssue.id, error: message }, 'createIssue failed')
    return { success: false, error: message }
  }
}

function mapPriorityToNumber(priority: string | undefined): number | undefined {
  switch (priority) {
    case 'urgent':
      return 1
    case 'high':
      return 2
    case 'medium':
      return 3
    case 'low':
      return 4
    case undefined:
      return undefined
    default:
      return undefined
  }
}
