import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core'

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

export const scheduledPrompts = sqliteTable(
  'scheduled_prompts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    prompt: text('prompt').notNull(),
    fireAt: text('fire_at').notNull(),
    cronExpression: text('cron_expression'),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    lastExecutedAt: text('last_executed_at'),
  },
  (table) => [
    index('idx_scheduled_prompts_user').on(table.userId),
    index('idx_scheduled_prompts_status_fire').on(table.status, table.fireAt),
  ],
)

export const alertPrompts = sqliteTable(
  'alert_prompts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    prompt: text('prompt').notNull(),
    condition: text('condition').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    lastTriggeredAt: text('last_triggered_at'),
    cooldownMinutes: integer('cooldown_minutes').notNull().default(60),
  },
  (table) => [index('idx_alert_prompts_user').on(table.userId), index('idx_alert_prompts_status').on(table.status)],
)

export const taskSnapshots = sqliteTable(
  'task_snapshots',
  {
    userId: text('user_id').notNull(),
    taskId: text('task_id').notNull(),
    field: text('field').notNull(),
    value: text('value').notNull(),
    capturedAt: text('captured_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.taskId, table.field] }),
    index('idx_task_snapshots_user').on(table.userId),
  ],
)

export type RecurringTask = typeof recurringTasks.$inferSelect
export type RecurringTaskOccurrence = typeof recurringTaskOccurrences.$inferSelect
export type ScheduledPromptRow = typeof scheduledPrompts.$inferSelect
export type AlertPromptRow = typeof alertPrompts.$inferSelect
export type TaskSnapshotRow = typeof taskSnapshots.$inferSelect

export const userInstructions = sqliteTable(
  'user_instructions',
  {
    id: text('id').primaryKey(),
    contextId: text('context_id').notNull(),
    text: text('text').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_user_instructions_context').on(table.contextId)],
)

export type UserInstruction = typeof userInstructions.$inferSelect

export type GroupMember = typeof groupMembers.$inferSelect
