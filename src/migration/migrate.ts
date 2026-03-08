import { getConfig } from '../config.js'
import { getMigrationStatus, setMigrationStatus, isMigrationComplete } from '../db/migration-status.js'
import { createIssue } from '../huly/create-issue.js'
import { getHulyClient } from '../huly/huly-client.js'
import { getOrCreateUserProject } from '../huly/project-utils.js'
import type { HulyClient } from '../huly/types.js'
import { withClient } from '../huly/utils/with-client.js'
import { logger } from '../logger.js'
import { mapLinearIssueToHuly } from './issue-mapper.js'
import { createLinearClient, fetchUserIssues, type LinearIssue } from './linear-client.js'

const log = logger.child({ scope: 'migration' })

export interface MigrationResult {
  success: boolean
  migratedCount: number
  errors: string[]
}

export async function runLinearToHulyMigration(): Promise<MigrationResult> {
  log.info('Starting Linear to Huly migration')

  // Check if already completed
  if (isMigrationComplete('linear_to_huly')) {
    log.info('Migration already completed, skipping')
    return { success: true, migratedCount: 0, errors: [] }
  }

  // Check current status
  const currentStatus = getMigrationStatus('linear_to_huly')
  if (currentStatus === 'in_progress') {
    log.warn('Migration already in progress, skipping to prevent conflicts')
    return { success: false, migratedCount: 0, errors: ['Migration already in progress'] }
  }

  setMigrationStatus('linear_to_huly', 'in_progress')

  const errors: string[] = []
  let migratedCount = 0

  try {
    // Get all users who have Linear credentials
    const db = (await import('../db/index.js')).getDb()
    const users = db
      .query<{ user_id: number }, []>(
        `SELECT DISTINCT user_id FROM user_config WHERE key IN ('linear_key', 'linear_team_id')`,
      )
      .all()

    log.info({ userCount: users.length }, 'Found users with Linear credentials')

    for (const { user_id: userId } of users) {
      try {
        const result = await migrateUserIssues(userId)
        migratedCount += result.count
        if (result.error) {
          errors.push(`User ${userId}: ${result.error}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`User ${userId}: ${message}`)
        log.error({ userId, error: message }, 'Failed to migrate user issues')
      }
    }

    const success = errors.length === 0
    if (success) {
      setMigrationStatus('linear_to_huly', 'completed')
      log.info({ migratedCount }, 'Migration completed successfully')
    } else {
      setMigrationStatus('linear_to_huly', 'failed', errors.join('; '))
      log.error({ errorCount: errors.length }, 'Migration completed with errors')
    }

    return { success, migratedCount, errors }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setMigrationStatus('linear_to_huly', 'failed', message)
    log.error({ error: message }, 'Migration failed')
    return { success: false, migratedCount, errors: [message] }
  }
}

interface UserMigrationResult {
  count: number
  error?: string
}

async function migrateUserIssues(userId: number): Promise<UserMigrationResult> {
  log.info({ userId }, 'Migrating user issues')

  const linearKey = getConfig(userId, 'linear_key')
  const linearTeamId = getConfig(userId, 'linear_team_id')
  const hulyEmail = getConfig(userId, 'huly_email')
  const hulyPassword = getConfig(userId, 'huly_password')

  if (!linearKey || !linearTeamId) {
    return { count: 0, error: 'Missing Linear credentials' }
  }

  if (!hulyEmail || !hulyPassword) {
    return { count: 0, error: 'Missing Huly credentials' }
  }

  // Create Linear client and fetch issues
  const linearClient = createLinearClient(linearKey)
  const linearIssues = await fetchUserIssues(linearClient, linearTeamId)

  if (linearIssues.length === 0) {
    log.info({ userId }, 'No Linear issues to migrate')
    return { count: 0 }
  }

  // Migrate issues using user's Huly client
  let migratedCount = 0
  let projectId: string | undefined

  try {
    await withClient(userId, getHulyClient, async (hulyClient) => {
      // Get or create user's personal project in Huly
      const project = await getOrCreateUserProject(hulyClient, userId)
      projectId = project._id

      for (const linearIssue of linearIssues) {
        try {
          const result = await migrateSingleIssue(hulyClient, userId, linearIssue, projectId)
          if (result.success) {
            migratedCount++
            log.debug({ linearId: linearIssue.id, userId, hulyId: result.issueId }, 'Migrated issue')
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          log.error({ linearId: linearIssue.id, error: message }, 'Failed to migrate issue')
          // Continue with other issues, don't fail entire user migration
        }
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { count: migratedCount, error: message }
  }

  log.info({ userId, migratedCount, totalCount: linearIssues.length }, 'User migration complete')
  return { count: migratedCount }
}

interface MigrationIssueResult {
  success: boolean
  issueId?: string
  error?: string
}

async function migrateSingleIssue(
  hulyClient: HulyClient,
  userId: number,
  linearIssue: LinearIssue,
  projectId: string,
): Promise<MigrationIssueResult> {
  const hulyData = mapLinearIssueToHuly(linearIssue, projectId)

  // Map priority from string to number if present
  let priority: number | undefined
  if (hulyData.priority === 'urgent') {
    priority = 1
  } else if (hulyData.priority === 'high') {
    priority = 2
  } else if (hulyData.priority === 'medium') {
    priority = 3
  } else if (hulyData.priority === 'low') {
    priority = 4
  }

  const result = await createIssue({
    userId,
    title: hulyData.title,
    description: hulyData.description,
    priority,
    projectId: hulyData.project,
  })

  return { success: true, issueId: result.id }
}
