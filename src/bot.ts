import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { APICallError } from '@ai-sdk/provider'
import { generateText, stepCountIs } from 'ai'
import { type ModelMessage } from 'ai'
import { Bot, type Context } from 'grammy'

import { registerAdminCommands } from './admin-commands.js'
import { CONFIG_KEYS, getAllConfig, getConfig, isConfigKey, maskValue, setConfig } from './config.js'
import { buildMessagesWithMemory, trimAndSummarise } from './conversation.js'
import { getUserMessage, isAppError } from './errors.js'
import { clearHistory, loadHistory, saveHistory } from './history.js'
import { logger } from './logger.js'
import { clearFacts, clearSummary, extractFactsFromSdkResults, upsertFact } from './memory.js'
import { makeTools } from './tools/index.js'
import { isAuthorized, listUsers, resolveUserByUsername, getKaneoWorkspace, setKaneoWorkspace } from './users.js'
import { formatLlmOutput } from './utils/format.js'
const log = logger.child({ scope: 'bot' })
const SYSTEM_PROMPT = `You are papai, a personal assistant that helps the user manage their Kaneo tasks directly from Telegram.
You can:
- Create new tasks with titles, descriptions, priorities, and project associations
- Update task statuses, priorities, and assignees
- Search for tasks by keyword
- List all tasks in a project
- List available projects and status columns
- Fetch full details of a specific task
- Add and read comments on tasks
- Create labels, list available labels; apply or remove labels on tasks
- Set due dates on tasks
- Create and read task relations (blocks, duplicate, related) stored as frontmatter in descriptions
- Create and manage projects
- Archive tasks by applying an "archived" label
Always confirm actions to the user in a friendly, concise manner. \
When creating or updating tasks, summarize what was done and include the task ID if available. \
If you need context (like project IDs), call list_projects first. \
To see available status columns for a project, call list_columns.`
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
const getOrCreateHistory = (userId: number): readonly ModelMessage[] => {
  log.debug({ userId }, 'getOrCreateHistory called')
  const history = loadHistory(userId)
  log.debug({ userId, messageCount: history.length }, 'Conversation history loaded')
  if (history.length === 0) {
    log.info({ userId }, 'No existing conversation history')
  }
  return history
}
const buildOpenAI = (apiKey: string, baseURL: string): ReturnType<typeof createOpenAICompatible> =>
  createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL })
const checkRequiredConfig = (userId: number): string[] => {
  const requiredKeys = ['openai_key', 'openai_base_url', 'openai_model', 'kaneo_key'] as const
  return requiredKeys.filter((k) => getConfig(userId, k) === null)
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
  if (getKaneoWorkspace(userId) !== null && getConfig(userId, 'kaneo_key') !== null) return
  const kaneoUrl = process.env['KANEO_CLIENT_URL']
  if (kaneoUrl === undefined) return
  try {
    const { provisionKaneoUser } = await import('./kaneo/provision.js')
    const kaneoInternalUrl = process.env['KANEO_INTERNAL_URL'] ?? kaneoUrl
    const prov = await provisionKaneoUser(kaneoInternalUrl, kaneoUrl, userId, ctx.from?.username ?? null)
    setConfig(userId, 'kaneo_key', prov.kaneoKey)
    setKaneoWorkspace(userId, prov.workspaceId)
    log.info({ userId }, 'Kaneo account provisioned on first use')
    await ctx.reply(
      `✅ Your Kaneo account has been created!\n🌐 ${kaneoUrl}\n📧 Email: ${prov.email}\n🔑 Password: ${prov.password}\n\nThe bot is already configured and ready to use.`,
    )
  } catch (err: unknown) {
    log.warn({ userId, error: err instanceof Error ? err.message : String(err) }, 'Kaneo auto-provisioning failed')
  }
}
const buildKaneoConfig = (userId: number): { apiKey: string; baseUrl: string; sessionCookie?: string } => {
  const kaneoKey = getConfig(userId, 'kaneo_key')!
  const kaneoBaseUrl = process.env['KANEO_CLIENT_URL']!
  const isSessionCookie = kaneoKey.startsWith('better-auth.session_token=')
  return isSessionCookie
    ? { apiKey: '', baseUrl: kaneoBaseUrl, sessionCookie: kaneoKey }
    : { apiKey: kaneoKey, baseUrl: kaneoBaseUrl }
}
const sendLlmResponse = async (
  ctx: Context,
  userId: number,
  history: readonly ModelMessage[],
  result: { text?: string; toolCalls?: unknown[]; response: { messages: ModelMessage[] } },
): Promise<void> => {
  const assistantText = result.text
  const textToFormat = assistantText !== undefined && assistantText !== '' ? assistantText : 'Done.'
  const formatted = formatLlmOutput(textToFormat)
  saveHistory(userId, [...history, ...result.response.messages])
  await ctx.reply(formatted.text, { entities: formatted.entities })
  log.info(
    { userId, responseLength: assistantText?.length ?? 0, toolCalls: result.toolCalls?.length ?? 0 },
    'Response sent successfully',
  )
}
const callLlm = async (ctx: Context, userId: number, history: readonly ModelMessage[]): Promise<void> => {
  await maybeProvisionKaneo(ctx, userId)
  const missing = checkRequiredConfig(userId)
  if (missing.length > 0) {
    log.warn({ userId, missing }, 'Missing required config keys')
    await ctx.reply(`Missing configuration: ${missing.join(', ')}.\nUse /set <key> <value> to configure.`)
    return
  }
  const openaiKey = getConfig(userId, 'openai_key')!
  const openaiBaseUrl = getConfig(userId, 'openai_base_url')!
  const openaiModel = getConfig(userId, 'openai_model')!
  const kaneoWorkspaceId = getKaneoWorkspace(userId)!
  const model = buildOpenAI(openaiKey, openaiBaseUrl)(openaiModel)
  const kaneoConfig = buildKaneoConfig(userId)
  const tools = makeTools({ kaneoConfig, workspaceId: kaneoWorkspaceId })
  const { messages: messagesWithMemory, memoryMsg } = buildMessagesWithMemory(userId, history)
  log.debug({ userId, historyLength: history.length, hasMemory: memoryMsg !== null }, 'Calling generateText')
  const result = await withTypingIndicator(ctx, () =>
    generateText({
      model,
      system: SYSTEM_PROMPT,
      messages: messagesWithMemory,
      tools,
      stopWhen: stepCountIs(25),
    }),
  )
  log.debug({ userId, toolCalls: result.toolCalls?.length, usage: result.usage }, 'LLM response received')
  persistFactsFromResults(userId, result.toolCalls, result.toolResults)
  await sendLlmResponse(ctx, userId, history, result)
}
const processMessage = async (ctx: Context, userId: number, userText: string): Promise<void> => {
  log.debug({ userId, userText }, 'processMessage called')
  log.info({ userId, messageLength: userText.length }, 'Message received from user')
  const history = await trimAndSummarise([...getOrCreateHistory(userId), { role: 'user', content: userText }], userId)
  saveHistory(userId, history)
  try {
    await callLlm(ctx, userId, history)
  } catch (error) {
    saveHistory(userId, history.slice(0, -1))
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
}
bot.command('set', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAuthorization(userId, ctx.from?.username)) {
    return
  }
  const match = ctx.match.trim()
  const spaceIndex = match.indexOf(' ')
  if (spaceIndex === -1) {
    await ctx.reply(`Usage: /set <key> <value>\nValid keys: ${CONFIG_KEYS.join(', ')}`)
    return
  }
  const key = match.slice(0, spaceIndex).trim()
  const value = match.slice(spaceIndex + 1).trim()
  if (!isConfigKey(key)) {
    await ctx.reply(`Unknown key: ${key}\nValid keys: ${CONFIG_KEYS.join(', ')}`)
    return
  }
  setConfig(userId, key, value)
  log.info({ userId, key }, '/set command executed')
  await ctx.reply(`Set ${key} successfully.`)
})
bot.command('config', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAuthorization(userId, ctx.from?.username)) {
    return
  }
  log.debug({ userId }, '/config command called')
  const config = getAllConfig(userId)
  const lines = CONFIG_KEYS.map((key) => {
    const value = config[key]
    if (value === undefined) {
      return `${key}: (not set)`
    }
    return `${key}: ${maskValue(key, value)}`
  })
  log.info({ userId }, '/config command executed')
  await ctx.reply(lines.join('\n'))
})
bot.command('clear', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAuthorization(userId, ctx.from?.username)) return
  log.debug({ userId }, '/clear command called')
  const arg = ctx.match.trim()
  if (arg === '') {
    clearHistory(userId)
    clearSummary(userId)
    clearFacts(userId)
    log.info({ userId }, '/clear command executed — all memory tiers cleared')
    await ctx.reply('Conversation history and memory cleared.')
    return
  }
  if (userId !== adminUserId) {
    await ctx.reply("Only the admin can clear other users' history.")
    return
  }
  if (arg === 'all') {
    const users = listUsers()
    for (const user of users) {
      clearHistory(user.telegram_id)
      clearSummary(user.telegram_id)
      clearFacts(user.telegram_id)
    }
    log.info({ userId, clearedCount: users.length }, '/clear all executed')
    await ctx.reply(`Cleared history and memory for all ${users.length} users.`)
    return
  }
  const targetId = parseInt(arg, 10)
  if (Number.isNaN(targetId)) {
    await ctx.reply('Usage: /clear [all | <user_id>]')
    return
  }
  clearHistory(targetId)
  clearSummary(targetId)
  clearFacts(targetId)
  log.info({ userId, targetId }, '/clear <user_id> executed')
  await ctx.reply(`Cleared history and memory for user ${targetId}.`)
})
registerAdminCommands(bot, adminUserId)
bot.on('message:text', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAuthorization(userId, ctx.from?.username)) {
    return
  }
  const userText = ctx.message.text
  await processMessage(ctx, userId, userText)
})
export { bot }
