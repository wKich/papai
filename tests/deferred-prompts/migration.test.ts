import { Database } from 'bun:sqlite'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { runMigrations } from '../../src/db/migrate.js'
import { migration001Initial } from '../../src/db/migrations/001_initial.js'
import { migration002ConversationHistory } from '../../src/db/migrations/002_conversation_history.js'
import { migration003MultiuserSupport } from '../../src/db/migrations/003_multiuser_support.js'
import { migration004KaneoWorkspace } from '../../src/db/migrations/004_kaneo_workspace.js'
import { migration005RenameConfigKeys } from '../../src/db/migrations/005_rename_config_keys.js'
import { migration006VersionAnnouncements } from '../../src/db/migrations/006_version_announcements.js'
import { migration007PlatformUserId } from '../../src/db/migrations/007_platform_user_id.js'
import { migration008GroupMembers } from '../../src/db/migrations/008_group_members.js'
import { migration009RecurringTasks } from '../../src/db/migrations/009_recurring_tasks.js'
import { migration010RecurringTaskOccurrences } from '../../src/db/migrations/010_recurring_task_occurrences.js'
import { migration011ProactiveAlerts } from '../../src/db/migrations/011_proactive_alerts.js'
import { migration012UserInstructions } from '../../src/db/migrations/012_user_instructions.js'
import { migration013DeferredPrompts } from '../../src/db/migrations/013_deferred_prompts.js'
import { migration014BackgroundEvents } from '../../src/db/migrations/014_background_events.js'
import { migration015DropBackgroundEvents } from '../../src/db/migrations/015_drop_background_events.js'

const ALL_MIGRATIONS = [
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
]

const getColumnNames = (db: Database, tableName: string): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info('${tableName}')`)
    .all()
    .map((c) => c.name)

const getTableNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((row) => row.name)

describe('migration 013: deferred prompts', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db, [...ALL_MIGRATIONS])
  })

  afterAll(() => {
    db.close()
  })

  test('creates scheduled_prompts table', () => {
    const columns = getColumnNames(db, 'scheduled_prompts')
    expect(columns).toContain('id')
    expect(columns).toContain('user_id')
    expect(columns).toContain('prompt')
    expect(columns).toContain('fire_at')
    expect(columns).toContain('cron_expression')
    expect(columns).toContain('status')
    expect(columns).toContain('created_at')
    expect(columns).toContain('last_executed_at')
  })

  test('creates alert_prompts table', () => {
    const columns = getColumnNames(db, 'alert_prompts')
    expect(columns).toContain('id')
    expect(columns).toContain('user_id')
    expect(columns).toContain('prompt')
    expect(columns).toContain('condition')
    expect(columns).toContain('status')
    expect(columns).toContain('created_at')
    expect(columns).toContain('last_triggered_at')
    expect(columns).toContain('cooldown_minutes')
  })

  test('creates task_snapshots table', () => {
    const columns = getColumnNames(db, 'task_snapshots')
    expect(columns).toContain('user_id')
    expect(columns).toContain('task_id')
    expect(columns).toContain('field')
    expect(columns).toContain('value')
    expect(columns).toContain('captured_at')
  })

  test('drops old proactive tables', () => {
    const names = getTableNames(db)
    expect(names).not.toContain('reminders')
    expect(names).not.toContain('user_briefing_state')
    expect(names).not.toContain('alert_state')
  })
})
