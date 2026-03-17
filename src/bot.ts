import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { APICallError } from '@ai-sdk/provider'
import { generateText, stepCountIs, type ToolSet } from 'ai'
import { type ModelMessage } from 'ai'
import { Bot, type Context } from 'grammy'

import { clearCachedTools, getCachedHistory, getCachedTools, setCachedTools } from './cache.js'
import {
  registerAdminCommands,
  registerClearCommand,
  registerConfigCommand,
  registerContextCommand,
  registerHelpCommand,
  registerSetCommand,
} from './commands/index.js'
import { getConfig, setConfig } from './config.js'
import { buildMessagesWithMemory, runTrimInBackground, shouldTriggerTrim } from './conversation.js'
import { getUserMessage, isAppError } from './errors.js'
import { appendHistory, saveHistory } from './history.js'
import { logger } from './logger.js'
import { extractFactsFromSdkResults, upsertFact } from './memory.js'
import { createProvider } from './providers/registry.js'
import type { TaskProvider } from './providers/types.js'
import { makeTools } from './tools/index.js'
import { isAuthorized, resolveUserByUsername, getKaneoWorkspace, setKaneoWorkspace } from './users.js'
import { formatLlmOutput } from './utils/format.js'

const log = logger.child({ scope: 'bot' })

const BASE_SYSTEM_PROMPT = `You are papai, a personal assistant that helps the user manage their tasks directly from Telegram.
Current date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

When the user asks you to do something, figure out which tool(s) to call and execute them autonomously — fetch any missing context (projects, columns, task details) with additional tool calls before acting, without asking the user.

WORKFLOW:
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
- Keep replies short and friendly.
- Don't use tables.`

const buildSystemPrompt = (provider: TaskProvider): string => {
  const addendum = provider.getPromptAddendum()
  if (addendum === '') return BASE_SYSTEM_PROMPT
  return `${BASE_SYSTEM_PROMPT}\n\n${addendum}`
}

const bot = new Bot(process.env['TELEGRAM_BOT_TOKEN']!)
const adminUserId = parseInt(process.env['TELEGRAM_USER_ID']!, 10)

const checkAuthorization = (userId: number | undefined, username?: string): userId is number => {
  log.debug({ userId }, 'Checking authorization')
  if (userId === undefined) return false
  if (isAuthorized(userId)) return true
  if (username !== undefined && resolveUserByUsername(userId, username)) return true
  log.warn({ attemptedUserId: userId }, 'Unauthorized access attempt')
  return false
}

const buildOpenAI = (apiKey: string, baseURL: string): ReturnType<typeof createOpenAICompatible> =>
  createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL })

const checkRequiredConfig = (userId: number): string[] => {
  const llmKeys = ['llm_apikey', 'llm_baseurl', 'main_model'] as const
  const providerName = getConfig(userId, 'provider') ?? 'kaneo'
  const providerKeys =
    providerName === 'youtrack' ? (['youtrack_url', 'youtrack_token'] as const) : (['kaneo_apikey'] as const)
  return [...llmKeys, ...providerKeys].filter((k) => getConfig(userId, k) === null)
}

const persistFactsFromResults = (
  userId: number,
  toolCalls: Array<{ toolName: string; input: unknown }>,
  toolResults: Array<{ toolName: string; output: unknown }>,
): void => {
  const newFacts = extractFactsFromSdkResults(toolCalls, toolResults)
  if (newFacts.length === 0) return
  for (const fact of newFacts) upsertFact(userId, fact)
  log.info({ userId, factsExtracted: newFacts.length, factsUpserted: newFacts.length }, 'Facts extracted and persisted')
}

const withTypingIndicator = async <T>(ctx: Context, fn: () => Promise<T>): Promise<T> => {
  const send = (): void => {
    ctx.replyWithChatAction('typing').catch(() => undefined)
  }
  send()
  const interval = setInterval(send, 4500)
  try {
    return await fn()
  } finally {
    clearInterval(interval)
  }
}

const maybeProvisionKaneo = async (ctx: Context, userId: number): Promise<void> => {
  if (getKaneoWorkspace(userId) !== null && getConfig(userId, 'kaneo_apikey') !== null) return
  const kaneoUrl = process.env['KANEO_CLIENT_URL']
  if (kaneoUrl === undefined) return
  try {
    const { provisionKaneoUser } = await import('./kaneo/provision.js')
    const kaneoInternalUrl = process.env['KANEO_INTERNAL_URL'] ?? kaneoUrl
    const prov = await provisionKaneoUser(kaneoInternalUrl, kaneoUrl, userId, ctx.from?.username ?? null)
    setConfig(userId, 'kaneo_apikey', prov.kaneoKey)
    setKaneoWorkspace(userId, prov.workspaceId)
    // Clear tools cache since kaneo config changed
    clearCachedTools(userId)
    log.info({ userId }, 'Kaneo account provisioned on first use')
    await ctx.reply(
      `✅ Your Kaneo account has been created!\n🌐 ${kaneoUrl}\n📧 Email: ${prov.email}\n🔑 Password: ${prov.password}\n\nThe bot is already configured and ready to use.`,
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const isRegistrationDisabled = msg.includes('sign-up') || msg.includes('registration') || msg.includes('Sign-up')
    log.warn({ userId, error: msg }, 'Kaneo auto-provisioning failed')
    if (isRegistrationDisabled) {
      await ctx.reply(
        'Kaneo account could not be created — registration is currently disabled on this instance.\n\nPlease ask the admin to provision your account.',
      )
    }
  }
}

const buildProvider = (userId: number): TaskProvider => {
  const providerName = getConfig(userId, 'provider') ?? 'kaneo'
  log.debug({ userId, providerName }, 'Building provider')

  if (providerName === 'kaneo') {
    const kaneoKey = getConfig(userId, 'kaneo_apikey')!
    const kaneoBaseUrl = process.env['KANEO_CLIENT_URL']!
    const workspaceId = getKaneoWorkspace(userId)!
    const isSessionCookie = kaneoKey.startsWith('better-auth.session_token=')
    const config: Record<string, string> = isSessionCookie
      ? { baseUrl: kaneoBaseUrl, sessionCookie: kaneoKey, workspaceId }
      : { apiKey: kaneoKey, baseUrl: kaneoBaseUrl, workspaceId }
    return createProvider('kaneo', config)
  }

  if (providerName === 'youtrack') {
    const baseUrl = getConfig(userId, 'youtrack_url')!
    const token = getConfig(userId, 'youtrack_token')!
    return createProvider('youtrack', { baseUrl, token })
  }

  return createProvider(providerName, {})
}

const isToolSet = (value: unknown): value is ToolSet =>
  typeof value === 'object' && value !== null && Object.keys(value).length > 0

const getOrCreateTools = (userId: number, provider: TaskProvider): ToolSet => {
  const cachedTools = getCachedTools(userId)
  if (cachedTools !== undefined && cachedTools !== null && isToolSet(cachedTools)) {
    log.debug({ userId }, 'Using cached tools')
    return cachedTools
  }
  log.debug({ userId }, 'Building tools (cache miss)')
  const tools = makeTools(provider)
  setCachedTools(userId, tools)
  return tools
}

const sendLlmResponse = async (
  ctx: Context,
  userId: number,
  result: { text?: string; toolCalls?: unknown[]; response: { messages: ModelMessage[] } },
): Promise<void> => {
  const assistantText = result.text
  const textToFormat = assistantText !== undefined && assistantText !== '' ? assistantText : 'Done.'
  const formatted = formatLlmOutput(textToFormat)
  await ctx.reply(formatted.text, { entities: formatted.entities })
  log.info(
    { userId, responseLength: assistantText?.length ?? 0, toolCalls: result.toolCalls?.length ?? 0 },
    'Response sent successfully',
  )
}

const callLlm = async (
  ctx: Context,
  userId: number,
  history: readonly ModelMessage[],
): Promise<{ response: { messages: ModelMessage[] } }> => {
  await maybeProvisionKaneo(ctx, userId)
  const missing = checkRequiredConfig(userId)
  if (missing.length > 0) {
    log.warn({ userId, missing }, 'Missing required config keys')
    await ctx.reply(`Missing configuration: ${missing.join(', ')}.\nUse /set <key> <value> to configure.`)
    throw new Error('Missing configuration')
  }
  const llmApiKey = getConfig(userId, 'llm_apikey')!
  const llmBaseUrl = getConfig(userId, 'llm_baseurl')!
  const mainModel = getConfig(userId, 'main_model')!
  const model = buildOpenAI(llmApiKey, llmBaseUrl)(mainModel)
  const provider = buildProvider(userId)
  const tools = getOrCreateTools(userId, provider)
  const { messages: messagesWithMemory, memoryMsg } = buildMessagesWithMemory(userId, history)
  log.debug({ userId, historyLength: history.length, hasMemory: memoryMsg !== null }, 'Calling generateText')
  const result = await generateText({
    model,
    system: buildSystemPrompt(provider),
    messages: messagesWithMemory,
    tools,
    stopWhen: stepCountIs(25),
  })
  log.debug({ userId, toolCalls: result.toolCalls?.length, usage: result.usage }, 'LLM response received')
  persistFactsFromResults(userId, result.toolCalls, result.toolResults)
  await sendLlmResponse(ctx, userId, result)
  return result
}

const handleMessageError = async (ctx: Context, userId: number, error: unknown): Promise<void> => {
  if (isAppError(error)) {
    const userMessage = getUserMessage(error)
    log.warn({ error: { type: error.type, code: error.code }, userId }, `Handled error: ${error.type}/${error.code}`)
    await ctx.reply(userMessage)
  } else if (APICallError.isInstance(error)) {
    log.error(
      {
        url: error.url,
        statusCode: error.statusCode,
        responseBody: error.responseBody,
        error: error.message,
        userId,
      },
      'LLM API call failed',
    )
    await ctx.reply('An unexpected error occurred. Please try again later.')
  } else {
    log.error(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        userId,
      },
      'Unexpected error generating response',
    )
    await ctx.reply('An unexpected error occurred. Please try again later.')
  }
}

const processMessage = async (ctx: Context, userId: number, userText: string): Promise<void> => {
  log.debug({ userId, userText }, 'processMessage called')
  log.info({ userId, messageLength: userText.length }, 'Message received from user')

  const baseHistory = getCachedHistory(userId)
  const newMessage: ModelMessage = { role: 'user', content: userText }
  const history = [...baseHistory, newMessage]

  appendHistory(userId, [newMessage])

  try {
    const result = await callLlm(ctx, userId, history)

    // Append assistant response to history
    const assistantMessages = result.response.messages.slice(history.length)
    if (assistantMessages.length > 0) {
      appendHistory(userId, assistantMessages)
      log.debug({ userId, assistantMessagesCount: assistantMessages.length }, 'Assistant response appended to history')
    }

    // Trigger trim only after successful response
    const needsTrim = shouldTriggerTrim([...history, ...assistantMessages])
    if (needsTrim) {
      void runTrimInBackground(userId, [...history, ...assistantMessages])
    }
  } catch (error) {
    saveHistory(userId, baseHistory)
    await handleMessageError(ctx, userId, error)
  }
}

registerHelpCommand(bot, checkAuthorization, adminUserId)
registerSetCommand(bot, checkAuthorization)
registerConfigCommand(bot, checkAuthorization)
registerContextCommand(bot, adminUserId)
registerClearCommand(bot, checkAuthorization, adminUserId)
registerAdminCommands(bot, adminUserId)

bot.on('message:text', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAuthorization(userId, ctx.from?.username)) {
    return
  }
  const userText = ctx.message.text
  await withTypingIndicator(ctx, () => processMessage(ctx, userId, userText))
})

export { bot }
