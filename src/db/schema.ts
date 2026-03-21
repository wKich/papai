import { sql } from 'drizzle-orm'
import { sqliteTable, text, primaryKey, index } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  platformUserId: text('platform_user_id').primaryKey(),
  username: text('username').unique(),
  addedAt: text('added_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  addedBy: text('added_by').notNull(),
  kaneoWorkspaceId: text('kaneo_workspace_id'),
})

export const userConfig = sqliteTable(
  'user_config',
  {
    userId: text('user_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.key] }), index('idx_user_config_user_id').on(table.userId)],
)

export const conversationHistory = sqliteTable('conversation_history', {
  userId: text('user_id').primaryKey(),
  messages: text('messages').notNull(),
})

export const memorySummary = sqliteTable('memory_summary', {
  userId: text('user_id').primaryKey(),
  summary: text('summary').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const memoryFacts = sqliteTable(
  'memory_facts',
  {
    userId: text('user_id').notNull(),
    identifier: text('identifier').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull().default(''),
    lastSeen: text('last_seen').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.identifier] }),
    index('idx_memory_facts_user_lastseen').on(table.userId, table.lastSeen),
  ],
)

export const versionAnnouncements = sqliteTable('version_announcements', {
  version: text('version').primaryKey(),
  announcedAt: text('announced_at').notNull(),
})

export const groupMembers = sqliteTable(
  'group_members',
  {
    groupId: text('group_id').notNull(),
    userId: text('user_id').notNull(),
    addedBy: text('added_by').notNull(),
    addedAt: text('added_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    index('idx_group_members_group').on(table.groupId),
    index('idx_group_members_user').on(table.userId),
  ],
)

export const recurringTasks = sqliteTable(
  'recurring_tasks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    projectId: text('project_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    priority: text('priority'),
    status: text('status'),
    assignee: text('assignee'),
    labels: text('labels'),
    triggerType: text('trigger_type').notNull().default('cron'),
    cronExpression: text('cron_expression'),
    timezone: text('timezone').notNull().default('UTC'),
    enabled: text('enabled').notNull().default('1'),
    catchUp: text('catch_up').notNull().default('0'),
    lastRun: text('last_run'),
    nextRun: text('next_run'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_recurring_tasks_user').on(table.userId),
    index('idx_recurring_tasks_enabled_next').on(table.enabled, table.nextRun),
  ],
)

export const recurringTaskOccurrences = sqliteTable(
  'recurring_task_occurrences',
  {
    id: text('id').primaryKey(),
    templateId: text('template_id').notNull(),
    taskId: text('task_id').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_recurring_occurrences_template').on(table.templateId),
    index('idx_recurring_occurrences_task').on(table.taskId),
  ],
)

export type RecurringTask = typeof recurringTasks.$inferSelect
export type RecurringTaskOccurrence = typeof recurringTaskOccurrences.$inferSelect

export type GroupMember = typeof groupMembers.$inferSelect
