import { nextCronOccurrence, parseCron } from '../cron.js'
import { logger } from '../logger.js'
import { advanceScheduledPrompt, completeScheduledPrompt } from './scheduled.js'
import type { ExecutionMetadata, ExecutionMode, ScheduledPrompt } from './types.js'

const log = logger.child({ scope: 'deferred:poller:scheduled' })

const MODE_PRIORITY: Record<ExecutionMode, number> = { lightweight: 0, context: 1, full: 2 }
const MODE_BY_PRIORITY: ExecutionMode[] = ['lightweight', 'context', 'full']

export function mergeExecutionMetadata(prompts: ScheduledPrompt[]): ExecutionMetadata {
  let maxPriority = 0
  const briefs: string[] = []
  const snapshots: string[] = []

  for (const prompt of prompts) {
    const metadata = prompt.executionMetadata
    maxPriority = Math.max(maxPriority, MODE_PRIORITY[metadata.mode])
    if (metadata.delivery_brief !== '') briefs.push(metadata.delivery_brief)
    if (metadata.context_snapshot !== null) snapshots.push(metadata.context_snapshot)
  }

  return {
    mode: MODE_BY_PRIORITY[maxPriority]!,
    delivery_brief: briefs.join('\n---\n'),
    context_snapshot: snapshots.length > 0 ? snapshots.join('\n---\n') : null,
  }
}

function finalizeRecurring(prompt: ScheduledPrompt, now: string, timezone: string): void {
  const parsed = parseCron(prompt.cronExpression!)
  if (parsed === null) {
    completeScheduledPrompt(prompt.id, prompt.userId, now)
    log.warn(
      { id: prompt.id, cronExpression: prompt.cronExpression },
      'Invalid cron expression on recurring prompt, completing',
    )
    return
  }

  const next = nextCronOccurrence(parsed, new Date(), timezone)
  if (next === null) {
    completeScheduledPrompt(prompt.id, prompt.userId, now)
    log.warn({ id: prompt.id, userId: prompt.userId }, 'Could not compute next cron occurrence, completing prompt')
    return
  }

  advanceScheduledPrompt(prompt.id, prompt.userId, next.toISOString(), now)
  log.info(
    { id: prompt.id, userId: prompt.userId, nextFireAt: next.toISOString() },
    'Recurring scheduled prompt advanced',
  )
}

export function finalizeAllPrompts(prompts: ScheduledPrompt[], now: string, timezone: string): void {
  for (const prompt of prompts) {
    if (prompt.cronExpression === null) {
      completeScheduledPrompt(prompt.id, prompt.userId, now)
      log.info({ id: prompt.id, userId: prompt.userId }, 'One-shot scheduled prompt completed')
      continue
    }

    finalizeRecurring(prompt, now, timezone)
  }
}
