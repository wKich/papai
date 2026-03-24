import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { APICallError } from '@ai-sdk/provider'
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai'

import { getCachedHistory, getCachedTools, setCachedTools } from './cache.js'
import type { ReplyFn } from './chat/types.js'
import { getConfig } from './config.js'
import { buildMessagesWithMemory, runTrimInBackground, shouldTriggerTrim } from './conversation.js'
import { consumeUnseenEvents, markEventsInjected } from './deferred-prompts/background-events.js'
import { getUserMessage, isAppError } from './errors.js'
import { appendHistory, saveHistory } from './history.js'
import { buildInstructionsBlock } from './instructions.js'
import { logger } from './logger.js'
import { extractFactsFromSdkResults, upsertFact } from './memory.js'
import { ProviderClassifiedError } from './providers/errors.js'
import { buildProviderForUser } from './providers/factory.js'
import { KaneoClassifiedError } from './providers/kaneo/classify-error.js'
import { provisionAndConfigure } from './providers/kaneo/provision.js'
import type { TaskProvider } from './providers/types.js'
import { YouTrackClassifiedError } from './providers/youtrack/classify-error.js'
import { makeTools } from './tools/index.js'
import { getKaneoWorkspace } from './users.js'

const log = logger.child({ scope: 'llm-orchestrator' })

const getLocalDateString = (timezone: string): string => {
  try {
    return new Date().toLocaleDateString('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }
}

const STATIC_RULES = `WORKFLOW:
1. Understand the user's intent from natural language.
2. Gather context if needed (e.g. call list_projects to resolve a project name, call list_columns before setting a task status).
3. Call the appropriate tool(s) to fulfil the request.
4. Reply with a concise confirmation.

AMBIGUITY — When the user's phrasing implies a single target (uses "the task", "it", "that one", or a specific title) but the search returns multiple equally-likely candidates, ask ONE short question to disambiguate before acting. When the phrasing implies multiple targets ("all", "every", "these", plural nouns), operate on all matches without asking. For referential phrases ("move it", "close that"), resolve from conversation context first; only ask if truly unresolvable.

DESTRUCTIVE ACTIONS — archive_task, archive_project, delete_column, remove_label:
These tools require a confidence field (0–1) reflecting how explicitly the user requested the action.
- Set 1.0 when the user has already confirmed (e.g. replied "yes").
- Set 0.9 for a direct, unambiguous command ("archive the Auth project").
- Set ≤0.7 when the intent is indirect or inferred.
If the tool returns { status: "confirmation_required", message: "..." }, send the message to the user as a natural question and wait for their reply before retrying the tool call with confidence 1.0.

RELATION TYPES — map user language to the correct type when calling add_task_relation / update_task_relation:
- "depends on" / "blocked by" / "waiting on" → blocked_by
- "blocks" / "is blocking" → blocks
- "duplicate of" / "same as" / "copy of" / "identical to" → duplicate
- "child of" / "subtask of" / "part of" → parent
- "related to" / "linked to" / anything else → related

OUTPUT RULES:
- When referencing tasks or projects, format them as Markdown links: [Task title](url). Never output raw IDs.
- Keep replies short and friendly. Don't use tables.
- When the user expresses a persistent preference ("always", "never", "from now on"), call save_instruction. To list them, call list_instructions. To remove one, call list_instructions first, then delete_instruction.`

const buildBasePrompt = (localDateStr: string): string => {
  return `You are papai, a personal assistant that helps the user manage their tasks.
Current date and time: ${localDateStr}.

When the user asks you to do something, figure out which tool(s) to call and execute them autonomously — fetch any missing context (projects, columns, task details) with additional tool calls before acting, without asking the user.

DUE DATES — When the user mentions a due date or time:
- Express dates as { date: "YYYY-MM-DD" } and times as { time: "HH:MM" } in 24-hour local time — the tool handles UTC conversion.
- "tomorrow at 5pm" → dueDate: { date: "YYYY-MM-DD", time: "17:00" } (tomorrow's date).
- "end of day" → dueDate: { date: "YYYY-MM-DD", time: "23:59" }.
- "next Monday" → dueDate: { date: "YYYY-MM-DD" } (date only, no time field).

RECURRING TASKS — The user can set up tasks that repeat automatically:
- "cron" trigger: Use create_recurring_task with triggerType "cron" and a schedule object (tool converts to cron internally).
  - schedule.frequency: "daily", "weekly", "monthly", "weekdays", or "weekends"
  - schedule.time: "HH:MM" in 24-hour local time (e.g. "09:00")
  - schedule.days_of_week: ["mon", "wed", "fri"] — for weekly frequency only
  - schedule.day_of_month: 1–31 — for monthly frequency only
  - Examples: "every Monday at 9am" → { frequency: "weekly", time: "09:00", days_of_week: ["mon"] }
  - "weekdays at 9am" → { frequency: "weekdays", time: "09:00" }
  - "1st of each month at 10am" → { frequency: "monthly", time: "10:00", day_of_month: 1 }
- "on_complete" trigger: creates the next task only after the current one is marked done. Use triggerType "on_complete" (no schedule needed).
- Use list_recurring_tasks to show all recurring definitions. Use pause/resume/skip/delete tools to manage them.
- When resuming, set createMissed=true to retroactively create tasks for missed cycles during the pause.
- When the user says "stop" or "cancel" a recurring task, use delete_recurring_task.
- When they say "pause", use pause_recurring_task. When "skip the next one", use skip_recurring_task.

DEFERRED PROMPTS — The user can set up automated tasks and alerts:
- SCHEDULED PROMPTS: Use create_deferred_prompt with a schedule to set up one-time or recurring LLM tasks.
  - One-time: provide schedule.fire_at as { date: "YYYY-MM-DD", time: "HH:MM" } in local time — tool converts to UTC.
  - Recurring: provide schedule.cron as a 5-field cron expression in local time (e.g. "0 9 * * 1" = every Monday 9am).
  - Common patterns: "0 9 * * 1" = every Monday 9am, "0 9 * * *" = daily 9am.
- ALERTS: Use create_deferred_prompt with a condition to monitor task changes.
  - Conditions use a filter schema: { field, op, value }. Fields: task.status, task.priority, task.assignee, task.dueDate, task.project, task.labels.
  - Operators: eq, neq, changed_to, lt, gt, overdue, contains, not_contains.
  - Combine with { and: [...] } or { or: [...] }.
  - Set cooldown_minutes to control how often alerts can fire (default: 60 minutes).
- Use list_deferred_prompts to show active prompts/alerts. Use cancel_deferred_prompt to cancel one.
- For daily briefings, create a recurring scheduled prompt (e.g., cron "0 9 * * *" at 9am).

${STATIC_RULES}`
}
const buildSystemPrompt = (provider: TaskProvider, timezone: string, contextId: string): string => {
  const localDateStr = getLocalDateString(timezone)
  const base = buildBasePrompt(localDateStr)
  const addendum = provider.getPromptAddendum()
  return `${buildInstructionsBlock(contextId)}${addendum === '' ? base : `${base}\n\n${addendum}`}`
}

const buildOpenAI = (apiKey: string, baseURL: string): ReturnType<typeof createOpenAICompatible> =>
  createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL })
const TASK_PROVIDER = process.env['TASK_PROVIDER'] ?? 'kaneo'

const checkRequiredConfig = (contextId: string): string[] => {
  const llmKeys = ['llm_apikey', 'llm_baseurl', 'main_model'] as const
  const providerKeys = TASK_PROVIDER === 'youtrack' ? (['youtrack_token'] as const) : (['kaneo_apikey'] as const)
  return [...llmKeys, ...providerKeys].filter((k) => getConfig(contextId, k) === null)
}

const persistFactsFromResults = (
  contextId: string,
  toolCalls: Array<{ toolName: string; input: unknown }>,
  toolResults: Array<{ toolName: string; output: unknown }>,
): void => {
  const newFacts = extractFactsFromSdkResults(toolCalls, toolResults)
  if (newFacts.length === 0) return
  for (const fact of newFacts) upsertFact(contextId, fact)
  log.info(
    { contextId, factsExtracted: newFacts.length, factsUpserted: newFacts.length },
    'Facts extracted and persisted',
  )
}

const maybeProvisionKaneo = async (reply: ReplyFn, contextId: string, username: string | null): Promise<void> => {
  if (getKaneoWorkspace(contextId) !== null && getConfig(contextId, 'kaneo_apikey') !== null) return
  const outcome = await provisionAndConfigure(contextId, username)
  if (outcome.status === 'provisioned') {
    await reply.text(
      `✅ Your Kaneo account has been created!\n🌐 ${outcome.kaneoUrl}\n📧 Email: ${outcome.email}\n🔑 Password: ${outcome.password}\n\nThe bot is already configured and ready to use.`,
    )
  } else if (outcome.status === 'registration_disabled') {
    await reply.text(
      'Kaneo account could not be created — registration is currently disabled on this instance.\n\nPlease ask the admin to provision your account.',
    )
  }
}

const buildProvider = (contextId: string): TaskProvider => buildProviderForUser(contextId, true)
const isToolSet = (value: unknown): value is ToolSet =>
  typeof value === 'object' && value !== null && Object.keys(value).length > 0

const getOrCreateTools = (contextId: string, provider: TaskProvider): ToolSet => {
  const cachedTools = getCachedTools(contextId)
  if (cachedTools !== undefined && cachedTools !== null && isToolSet(cachedTools)) {
    log.debug({ contextId }, 'Using cached tools')
    return cachedTools
  }
  log.debug({ contextId }, 'Building tools (cache miss)')
  const tools = makeTools(provider, contextId)
  setCachedTools(contextId, tools)
  return tools
}

const sendLlmResponse = async (
  reply: ReplyFn,
  contextId: string,
  result: { text?: string; toolCalls?: unknown[]; response: { messages: ModelMessage[] } },
): Promise<void> => {
  const textToFormat = result.text !== undefined && result.text !== '' ? result.text : 'Done.'
  await reply.formatted(textToFormat)
  log.info(
    { contextId, responseLength: result.text?.length ?? 0, toolCalls: result.toolCalls?.length ?? 0 },
    'Response sent successfully',
  )
}

const callLlm = async (
  reply: ReplyFn,
  contextId: string,
  username: string | null,
  history: readonly ModelMessage[],
): Promise<{ response: { messages: ModelMessage[] } }> => {
  await maybeProvisionKaneo(reply, contextId, username)
  const missing = checkRequiredConfig(contextId)
  if (missing.length > 0) {
    log.warn({ contextId, missing }, 'Missing required config keys')
    await reply.text(`Missing configuration: ${missing.join(', ')}.\nUse /set <key> <value> to configure.`)
    throw new Error('Missing configuration')
  }
  const llmApiKey = getConfig(contextId, 'llm_apikey')!
  const llmBaseUrl = getConfig(contextId, 'llm_baseurl')!
  const mainModel = getConfig(contextId, 'main_model')!
  const model = buildOpenAI(llmApiKey, llmBaseUrl)(mainModel)
  const provider = buildProvider(contextId)
  const tools = getOrCreateTools(contextId, provider)
  const timezone = getConfig(contextId, 'timezone') ?? 'UTC'
  const { messages: messagesWithMemory, memoryMsg } = buildMessagesWithMemory(contextId, history)
  const bgResult = consumeUnseenEvents(contextId)
  const finalMessages =
    bgResult === null
      ? messagesWithMemory
      : [{ role: 'system' as const, content: bgResult.systemContent }, ...messagesWithMemory]
  log.debug(
    { contextId, historyLength: history.length, hasMemory: memoryMsg !== null, timezone },
    'Calling generateText',
  )
  const result = await generateText({
    model,
    system: buildSystemPrompt(provider, timezone, contextId),
    messages: finalMessages,
    tools,
    stopWhen: stepCountIs(25),
  })
  log.debug({ contextId, toolCalls: result.toolCalls?.length, usage: result.usage }, 'LLM response received')
  if (bgResult !== null) {
    markEventsInjected(bgResult.eventIds)
    appendHistory(contextId, bgResult.historyEntries)
  }
  persistFactsFromResults(contextId, result.toolCalls, result.toolResults)
  await sendLlmResponse(reply, contextId, result)
  return result
}

const handleMessageError = async (reply: ReplyFn, contextId: string, error: unknown): Promise<void> => {
  const errData = isAppError(error) ? error : error instanceof Error ? error.message : String(error)
  log.error({ contextId, error: errData }, 'Message handling failed')
  if (isAppError(error)) await reply.text(getUserMessage(error))
  else if (error instanceof KaneoClassifiedError || error instanceof YouTrackClassifiedError)
    await reply.text(getUserMessage(error.appError))
  else if (error instanceof ProviderClassifiedError) await reply.text(getUserMessage(error.error))
  else
    await reply.text(
      APICallError.isInstance(error)
        ? 'API call failed. Please try again.'
        : 'An unexpected error occurred. Please try again later.',
    )
}

export const processMessage = async (
  reply: ReplyFn,
  contextId: string,
  username: string | null,
  userText: string,
): Promise<void> => {
  log.debug({ contextId, userText }, 'processMessage called')
  log.info({ contextId, messageLength: userText.length }, 'Message received from user')

  const baseHistory = getCachedHistory(contextId)
  const newMessage: ModelMessage = { role: 'user', content: userText }
  const history = [...baseHistory, newMessage]
  appendHistory(contextId, [newMessage])
  try {
    const result = await callLlm(reply, contextId, username, history)
    const assistantMessages = result.response.messages
    if (assistantMessages.length > 0) {
      appendHistory(contextId, assistantMessages)
      log.debug(
        { contextId, assistantMessagesCount: assistantMessages.length },
        'Assistant response appended to history',
      )
    }
    if (shouldTriggerTrim([...history, ...assistantMessages])) {
      void runTrimInBackground(contextId, [...history, ...assistantMessages])
    }
  } catch (error) {
    saveHistory(contextId, baseHistory)
    await handleMessageError(reply, contextId, error)
  }
}
