import { eq } from 'drizzle-orm'

import { getConfig } from '../config.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { userBriefingState } from '../db/schema.js'
import { logger } from '../logger.js'
import type { TaskProvider, TaskListItem } from '../providers/types.js'
import type { BriefingMode, BriefingSection, BriefingTask } from './types.js'

const log = logger.child({ scope: 'proactive:briefing' })

const TERMINAL_STATUS_SLUGS = ['done', 'completed', "won't fix", 'cancelled', 'archived']

const isTerminalStatus = (status: string | undefined): boolean => {
  if (status === undefined) return false
  const lower = status.toLowerCase()
  return TERMINAL_STATUS_SLUGS.some((slug) => lower.includes(slug))
}

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

export function buildSections(tasks: TaskListItem[], timezone: string): BriefingSection[] {
  log.debug({ taskCount: tasks.length }, 'buildSections called')

  const today = getTodayInTz(timezone)
  const nonTerminal = tasks.filter((t) => !isTerminalStatus(t.status))

  const dueToday: BriefingTask[] = []
  const overdue: BriefingTask[] = []
  const inProgress: BriefingTask[] = []

  for (const task of nonTerminal) {
    const due = task.dueDate?.slice(0, 10)

    if (due === today) {
      dueToday.push(toTask(task))
    } else if (due !== undefined && due < today) {
      overdue.push(toTask(task))
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

  const sections: BriefingSection[] = []
  if (dueToday.length > 0) sections.push({ title: 'Due Today', tasks: dueToday })
  if (overdue.length > 0) sections.push({ title: 'Overdue', tasks: overdue })
  if (inProgress.length > 0) sections.push({ title: 'In Progress', tasks: inProgress })

  return sections
}

export function suggestActions(sections: BriefingSection[]): BriefingTask[] {
  log.debug('suggestActions called')
  const overdueTasks = sections.find((s) => s.title === 'Overdue')?.tasks ?? []
  const dueTodayTasks = sections.find((s) => s.title === 'Due Today')?.tasks ?? []

  const priorityOrder = ['urgent', 'high', 'medium', 'low']
  const sortByPriority = (a: BriefingTask, b: BriefingTask): number => {
    const aIdx = priorityOrder.indexOf(a.priority?.toLowerCase() ?? 'low')
    const bIdx = priorityOrder.indexOf(b.priority?.toLowerCase() ?? 'low')
    return aIdx - bIdx
  }

  const sorted = [...overdueTasks.sort(sortByPriority), ...dueTodayTasks.sort(sortByPriority)]
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

async function fetchAllTasks(provider: TaskProvider): Promise<TaskListItem[]> {
  const allTasks: TaskListItem[] = []

  if (provider.capabilities.has('projects.list') && provider.listProjects !== undefined) {
    const projects = await provider.listProjects()
    const results = await Promise.allSettled(projects.slice(0, 20).map((p) => provider.listTasks(p.id)))
    for (const [i, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        allTasks.push(...result.value)
      } else {
        const project = projects[i]!
        log.warn(
          {
            projectId: project.id,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          },
          'Failed to list tasks for project in briefing',
        )
      }
    }
  } else {
    try {
      const results = await provider.searchTasks({ query: '' })
      allTasks.push(
        ...results.map((t) => ({
          id: t.id,
          title: t.title,
          number: t.number,
          status: t.status,
          priority: t.priority,
          dueDate: undefined,
          url: t.url,
        })),
      )
    } catch (err) {
      log.warn({ error: err instanceof Error ? err.message : String(err) }, 'Failed to search tasks for briefing')
    }
  }

  return allTasks
}

export async function generate(userId: string, provider: TaskProvider, mode: BriefingMode): Promise<string> {
  log.debug({ userId, mode }, 'generate briefing called')

  const timezone = getConfig(userId, 'briefing_timezone') ?? getConfig(userId, 'timezone') ?? 'UTC'
  const tasks = await fetchAllTasks(provider)
  const sections = buildSections(tasks, timezone)
  const date = getFormattedDateInTz(timezone)

  const briefing = mode === 'short' ? formatShort(sections) : formatFull(date, sections)

  // Update briefing state
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

  log.info({ userId, mode, sectionCount: sections.length }, 'Briefing generated')
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

  const briefingMinutes = briefHour * 60 + briefMinute
  const currentMinutes = currentHour * 60 + currentMinute

  if (currentMinutes < briefingMinutes) return null

  // Briefing time has passed and wasn't delivered — generate catch-up
  const mode = getConfig(userId, 'briefing_mode') === 'short' ? 'short' : 'full'
  const briefing = await generate(userId, provider, mode)

  return `**(Catch-up — missed ${briefingTime} briefing)**\n\n${briefing}`
}
