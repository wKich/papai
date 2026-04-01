import { Database } from 'bun:sqlite'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'db:index' })

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
import { migration010RecurringTaskOccurrences } from './migrations/010_recurring_task_occurrences.js'
import { migration011ProactiveAlerts } from './migrations/011_proactive_alerts.js'
import { migration012UserInstructions } from './migrations/012_user_instructions.js'
import { migration013DeferredPrompts } from './migrations/013_deferred_prompts.js'
import { migration014BackgroundEvents } from './migrations/014_background_events.js'
import { migration015DropBackgroundEvents } from './migrations/015_drop_background_events.js'
import { migration016ExecutionMetadata } from './migrations/016_execution_metadata.js'
import { migration017MessageMetadata } from './migrations/017_message_metadata.js'
import { migration018Memos } from './migrations/018_memos.js'

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
    log.info({ dbPath: DB_PATH }, 'Database connection created for migrations')
  }
  return migrationDbInstance
}

const closeMigrationDb = (): void => {
  if (migrationDbInstance !== undefined) {
    migrationDbInstance.close()
    migrationDbInstance = undefined
    log.info({ dbPath: DB_PATH }, 'Migration database connection closed')
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
  migration010RecurringTaskOccurrences,
  migration011ProactiveAlerts,
  migration012UserInstructions,
  migration013DeferredPrompts,
  migration014BackgroundEvents,
  migration015DropBackgroundEvents,
  migration016ExecutionMetadata,
  migration017MessageMetadata,
  migration018Memos,
] as const

export const initDb = (): void => {
  runMigrations(getMigrationDb(), MIGRATIONS)
}

export const closeMigrationDbInstance = (): void => {
  closeMigrationDb()
}
