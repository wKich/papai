import { eq } from 'drizzle-orm'

import { getConfig } from '../config.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { userBriefingState, alertState } from '../db/schema.js'
import type { AlertStateRow } from '../db/schema.js'
import { logger } from '../logger.js'
import type { TaskProvider, TaskListItem } from '../providers/types.js'
import { fetchAllTasks, isTerminalStatus } from './shared.js'
import type { BriefingMode, BriefingSection, BriefingTask } from './types.js'

const log = logger.child({ scope: 'proactive:briefing' })

const getTodayInTz = (timezone: string): string => {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

const getFormattedDateInTz = (timezone: string): string => {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date())
  } catch {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }
}

const toTask = (t: TaskListItem): BriefingTask => ({
  id: t.id,
  title: t.title,
  url: t.url,
  dueDate: t.dueDate,
  status: t.status,
  priority: t.priority,
})

type TaskCategories = {
  dueToday: BriefingTask[]
  overdue: BriefingTask[]
  inProgress: BriefingTask[]
  dueTodayIds: Set<string>
  overdueIds: Set<string>
}

function categorizeTasks(nonTerminal: TaskListItem[], today: string): TaskCategories {
  const dueToday: BriefingTask[] = []
  const overdue: BriefingTask[] = []
  const inProgress: BriefingTask[] = []
  const dueTodayIds = new Set<string>()
  const overdueIds = new Set<string>()

  for (const task of nonTerminal) {
    const due = task.dueDate?.slice(0, 10)
    if (due === today) {
      dueToday.push(toTask(task))
      dueTodayIds.add(task.id)
    } else if (due !== undefined && due < today) {
      overdue.push(toTask(task))
      overdueIds.add(task.id)
    }
    const statusLower = task.status?.toLowerCase() ?? ''
    if (
      statusLower.includes('in-progress') ||
      statusLower.includes('in-review') ||
      statusLower.includes('in progress')
    ) {
      inProgress.push(toTask(task))
    }
  }
  return { dueToday, overdue, inProgress, dueTodayIds, overdueIds }
}

function buildRecentlyUpdated(
  nonTerminal: TaskListItem[],
  alertStateRows: AlertStateRow[],
  dueTodayIds: Set<string>,
  overdueIds: Set<string>,
  cutoff24h: number,
): BriefingTask[] {
  const byTaskId = new Map(alertStateRows.map((r) => [r.taskId, r]))
  return nonTerminal.flatMap((task) => {
    if (dueTodayIds.has(task.id) || overdueIds.has(task.id)) return []
    const row = byTaskId.get(task.id)
    if (row?.lastStatusChangedAt === undefined || row.lastStatusChangedAt === null) return []
    return new Date(row.lastStatusChangedAt).getTime() >= cutoff24h ? [toTask(task)] : []
  })
}

export function buildSections(
  tasks: TaskListItem[],
  timezone: string,
  alertStateRows?: AlertStateRow[],
): BriefingSection[] {
  log.debug({ taskCount: tasks.length }, 'buildSections called')

  const today = getTodayInTz(timezone)
  const nonTerminal = tasks.filter((t) => !isTerminalStatus(t.status))
  const { dueToday, overdue, inProgress, dueTodayIds, overdueIds } = categorizeTasks(nonTerminal, today)

  const recentlyUpdated =
    alertStateRows === undefined
      ? []
      : buildRecentlyUpdated(nonTerminal, alertStateRows, dueTodayIds, overdueIds, Date.now() - 24 * 60 * 60 * 1000)

  const sections: BriefingSection[] = []
  if (dueToday.length > 0) sections.push({ title: 'Due Today', tasks: dueToday })
  if (overdue.length > 0) sections.push({ title: 'Overdue', tasks: overdue })
  if (inProgress.length > 0) sections.push({ title: 'In Progress', tasks: inProgress })
  if (recentlyUpdated.length > 0) sections.push({ title: 'Recently Updated', tasks: recentlyUpdated })

  return sections
}

export function suggestActions(sections: BriefingSection[]): BriefingTask[] {
  log.debug('suggestActions called')
  const overdueTasks = sections.find((s) => s.title === 'Overdue')?.tasks ?? []
  const dueTodayTasks = sections.find((s) => s.title === 'Due Today')?.tasks ?? []

  const priorityOrder = ['urgent', 'high', 'medium', 'low']

  const getPriorityIndex = (priority: string | undefined): number => {
    if (priority === undefined) return priorityOrder.indexOf('low')
    const idx = priorityOrder.indexOf(priority.toLowerCase())
    return idx === -1 ? priorityOrder.length : idx
  }

  const sortByPriority = (a: BriefingTask, b: BriefingTask): number => {
    const aIdx = getPriorityIndex(a.priority)
    const bIdx = getPriorityIndex(b.priority)
    return aIdx - bIdx
  }

  const sorted = [...overdueTasks.toSorted(sortByPriority), ...dueTodayTasks.toSorted(sortByPriority)]
  return sorted.slice(0, 3)
}

export function formatFull(date: string, sections: BriefingSection[]): string {
  const lines: string[] = [`**📋 Morning Briefing — ${date}**`, '']

  if (sections.length === 0) {
    lines.push('No tasks require attention today. 🎉')
    return lines.join('\n')
  }

  for (const section of sections) {
    lines.push(`**${section.title}**`)
    for (const task of section.tasks) {
      const link = task.url === undefined ? task.title : `[${task.title}](${task.url})`
      const duePart = task.dueDate !== undefined && task.dueDate !== null ? ` (due ${task.dueDate.slice(0, 10)})` : ''
      lines.push(`- ${link}${duePart}`)
    }
    lines.push('')
  }

  const actions = suggestActions(sections)
  if (actions.length > 0) {
    lines.push('**Suggested Actions**')
    for (const task of actions) {
      const link = task.url === undefined ? task.title : `[${task.title}](${task.url})`
      lines.push(`- ${link}`)
    }
  }

  return lines.join('\n')
}

export function formatShort(sections: BriefingSection[]): string {
  const counts: string[] = []
  for (const section of sections) {
    counts.push(`${section.tasks.length} ${section.title.toLowerCase()}`)
  }
  if (counts.length === 0) return 'No tasks require attention today.'
  return counts.join(' · ')
}

/** Generate briefing content. Does NOT update user_briefing_state (use generateAndRecord for that). */
export async function generate(userId: string, provider: TaskProvider, mode: BriefingMode): Promise<string> {
  log.debug({ userId, mode }, 'generate briefing called')

  const timezone = getConfig(userId, 'briefing_timezone') ?? getConfig(userId, 'timezone') ?? 'UTC'
  const tasks = await fetchAllTasks(provider)

  // Fetch alert state rows for the Recently Updated section
  const db = getDrizzleDb()
  const alertStateRows = db.select().from(alertState).where(eq(alertState.userId, userId)).all()

  const sections = buildSections(tasks, timezone, alertStateRows)
  const date = getFormattedDateInTz(timezone)

  const briefing = mode === 'short' ? formatShort(sections) : formatFull(date, sections)

  log.info({ userId, mode, sectionCount: sections.length }, 'Briefing generated')
  return briefing
}

/** Record that a briefing was delivered today for the given user. */
export function recordBriefingDelivery(userId: string, timezone: string): void {
  const db = getDrizzleDb()
  const today = getTodayInTz(timezone)
  const now = new Date().toISOString()

  db.insert(userBriefingState)
    .values({ userId, lastBriefingDate: today, lastBriefingAt: now })
    .onConflictDoUpdate({
      target: userBriefingState.userId,
      set: { lastBriefingDate: today, lastBriefingAt: now },
    })
    .run()
}

/** Generate briefing content AND record the delivery in user_briefing_state. Use for scheduled/catch-up briefings. */
export async function generateAndRecord(userId: string, provider: TaskProvider, mode: BriefingMode): Promise<string> {
  const timezone = getConfig(userId, 'briefing_timezone') ?? getConfig(userId, 'timezone') ?? 'UTC'
  const briefing = await generate(userId, provider, mode)
  recordBriefingDelivery(userId, timezone)
  return briefing
}

export async function getMissedBriefing(userId: string, provider: TaskProvider): Promise<string | null> {
  log.debug({ userId }, 'getMissedBriefing called')

  const briefingTime = getConfig(userId, 'briefing_time')
  if (briefingTime === null) return null

  const timezone = getConfig(userId, 'briefing_timezone') ?? getConfig(userId, 'timezone') ?? 'UTC'
  const today = getTodayInTz(timezone)

  // Check if briefing was already delivered today
  const db = getDrizzleDb()
  const state = db.select().from(userBriefingState).where(eq(userBriefingState.userId, userId)).get()

  if (state?.lastBriefingDate === today) return null

  // Check if the briefing time has passed
  const nowParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date())

  const currentHour = Number.parseInt(nowParts.find((p) => p.type === 'hour')?.value ?? '0', 10)
  const currentMinute = Number.parseInt(nowParts.find((p) => p.type === 'minute')?.value ?? '0', 10)

  const [briefHour, briefMinute] = briefingTime.split(':').map(Number)
  if (briefHour === undefined || briefMinute === undefined) return null
  if (!Number.isFinite(briefHour) || !Number.isFinite(briefMinute)) return null
  if (briefHour < 0 || briefHour > 23 || briefMinute < 0 || briefMinute > 59) return null

  const briefingMinutes = briefHour * 60 + briefMinute
  const currentMinutes = currentHour * 60 + currentMinute

  if (currentMinutes < briefingMinutes) return null

  // Briefing time has passed and wasn't delivered — generate catch-up (records delivery)
  const mode = getConfig(userId, 'briefing_mode') === 'short' ? 'short' : 'full'
  const briefing = await generateAndRecord(userId, provider, mode)

  return `**(Catch-up — missed ${briefingTime} briefing)**\n\n${briefing}`
}
