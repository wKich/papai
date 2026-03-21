import { Database } from 'bun:sqlite'

import { logger } from '../logger.js'
import { runMigrations } from './migrate.js'
import { migration001Initial } from './migrations/001_initial.js'
import { migration002ConversationHistory } from './migrations/002_conversation_history.js'
import { migration003MultiuserSupport } from './migrations/003_multiuser_support.js'
import { migration004KaneoWorkspace } from './migrations/004_kaneo_workspace.js'
import { migration005RenameConfigKeys } from './migrations/005_rename_config_keys.js'
import { migration006VersionAnnouncements } from './migrations/006_version_announcements.js'
import { migration007PlatformUserId } from './migrations/007_platform_user_id.js'
import { migration008GroupMembers } from './migrations/008_group_members.js'
import { migration009RecurringTasks } from './migrations/009_recurring_tasks.js'

const DB_PATH = process.env['DB_PATH'] ?? 'papai.db'

let migrationDbInstance: Database | undefined

const getMigrationDb = (): Database => {
  if (migrationDbInstance === undefined) {
    migrationDbInstance = new Database(DB_PATH)
    // WAL mode is set here rather than in migrations because it must be
    // configured per-database-connection, not per-database-file. This ensures
    // WAL is active immediately on first connection, before any migrations run.
    migrationDbInstance.run('PRAGMA journal_mode=WAL')
    migrationDbInstance.run('PRAGMA foreign_keys=ON')
    logger.info({ dbPath: DB_PATH }, 'Database connection created for migrations')
  }
  return migrationDbInstance
}

const closeMigrationDb = (): void => {
  if (migrationDbInstance !== undefined) {
    migrationDbInstance.close()
    migrationDbInstance = undefined
    logger.info({ dbPath: DB_PATH }, 'Migration database connection closed')
  }
}

const MIGRATIONS = [
  migration001Initial,
  migration002ConversationHistory,
  migration003MultiuserSupport,
  migration004KaneoWorkspace,
  migration005RenameConfigKeys,
  migration006VersionAnnouncements,
  migration007PlatformUserId,
  migration008GroupMembers,
  migration009RecurringTasks,
] as const

export const initDb = (): void => {
  runMigrations(getMigrationDb(), MIGRATIONS)
}

export const closeMigrationDbInstance = (): void => {
  closeMigrationDb()
}
