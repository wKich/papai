import { createOpenAI } from '@ai-sdk/openai'
import { generateText, stepCountIs } from 'ai'
import { type ModelMessage } from 'ai'
import { Bot, type Context } from 'grammy'

import { CONFIG_KEYS, getAllConfig, getConfig, isConfigKey, maskValue, setConfig } from './config.js'
import { logger } from './logger.js'
import { makeTools } from './tools.js'

const SYSTEM_PROMPT = `You are papai, an expert project manager and personal productivity assistant. \
You help the user manage their Linear tasks directly from Telegram.

You can:
- Create new issues with titles, descriptions, priorities, and project associations
- Update issue statuses and assignees
- Search for issues by keyword or state
- List available teams and projects

Always confirm actions to the user in a friendly, concise manner. \
When creating or updating tasks, summarize what was done and include the issue identifier and URL if available. \
If you need context (like project IDs), call list_projects first.`

const bot = new Bot(process.env['TELEGRAM_BOT_TOKEN']!)
const allowedUserId = parseInt(process.env['TELEGRAM_USER_ID']!, 10)

const conversationHistory = new Map<number, ModelMessage[]>()

const checkAuthorization = (userId: number | undefined): userId is number => {
  logger.debug({ userId, allowedUserId }, 'Checking authorization')
  if (userId === undefined || userId !== allowedUserId) {
    if (userId !== undefined) {
      logger.warn({ attemptedUserId: userId }, 'Unauthorized access attempt')
    }
    return false
  }
  return true
}

const getOrCreateHistory = (userId: number): ModelMessage[] => {
  logger.debug({ userId }, 'getOrCreateHistory called')
  const existing = conversationHistory.has(userId)
  logger.debug(
    { userId, exists: existing, currentSize: conversationHistory.get(userId)?.length },
    'Getting conversation history',
  )
  if (!existing) {
    conversationHistory.set(userId, [])
    logger.info({ userId }, 'New conversation history initialized')
  }
  return conversationHistory.get(userId)!
}

const trimHistory = (history: ModelMessage[], userId: number): void => {
  logger.debug({ userId, historyLength: history.length }, 'trimHistory called')
  if (history.length > 40) {
    const removedCount = history.length - 40
    history.splice(0, history.length - 40)
    logger.warn({ userId, removedCount, newSize: history.length }, 'Conversation history truncated')
  }
}

const buildOpenAI = (apiKey: string, baseURL: string | null): ReturnType<typeof createOpenAI> => {
  const opts = baseURL === null ? { apiKey } : { apiKey, baseURL }
  return createOpenAI(opts)
}

const callLlm = async (ctx: Context, userId: number, history: ModelMessage[]): Promise<void> => {
  const openaiKey = getConfig('openai_key')
  const linearKey = getConfig('linear_key')
  const linearTeamId = getConfig('linear_team_id')

  if (openaiKey === null || linearKey === null || linearTeamId === null) {
    const requiredKeys = ['openai_key', 'linear_key', 'linear_team_id'] as const
    const missing = requiredKeys.filter((k) => getConfig(k) === null)
    logger.warn({ userId, missing }, 'Missing required config keys')
    await ctx.reply(
      `Missing configuration: ${missing.join(', ')}.\nUse /set <key> <value> to configure. Keys: openai_key, linear_key, linear_team_id.`,
    )
    return
  }

  const openaiModel = getConfig('openai_model') ?? 'gpt-4o'
  const model = buildOpenAI(openaiKey, getConfig('openai_base_url'))(openaiModel)
  const tools = makeTools({ linearKey, linearTeamId })

  logger.debug({ userId, historyLength: history.length }, 'Calling generateText')
  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    messages: history,
    tools,
    stopWhen: stepCountIs(5),
  })

  logger.debug({ userId, toolCalls: result.toolCalls?.length, usage: result.usage }, 'LLM response received')
  const assistantText = result.text
  history.push(...result.response.messages)
  await ctx.reply(assistantText || 'Done.')
  logger.info(
    { userId, responseLength: assistantText?.length ?? 0, toolCalls: result.toolCalls?.length ?? 0 },
    'Response sent successfully',
  )
}

const processMessage = async (ctx: Context, userId: number, userText: string): Promise<void> => {
  logger.debug({ userId, userText }, 'processMessage called')
  logger.info({ userId, messageLength: userText.length }, 'Message received from user')

  const history = getOrCreateHistory(userId)
  history.push({ role: 'user', content: userText })
  trimHistory(history, userId)

  try {
    await callLlm(ctx, userId, history)
  } catch (error) {
    history.pop()
    logger.error({ error: error instanceof Error ? error.message : String(error), userId }, 'Error generating response')
    await ctx.reply('Sorry, something went wrong. Please try again.')
  }
}

bot.command('set', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAuthorization(userId)) {
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

  setConfig(key, value)
  logger.info({ userId, key }, '/set command executed')
  await ctx.reply(`Set ${key} successfully.`)
})

bot.command('config', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAuthorization(userId)) {
    return
  }

  logger.debug({ userId }, '/config command called')
  const config = getAllConfig()
  const lines = CONFIG_KEYS.map((key) => {
    const value = config[key]
    if (value === undefined) {
      return `${key}: (not set)`
    }
    return `${key}: ${maskValue(key, value)}`
  })
  logger.info({ userId }, '/config command executed')
  await ctx.reply(lines.join('\n'))
})

bot.on('message:text', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAuthorization(userId)) {
    return
  }

  const userText = ctx.message.text
  await processMessage(ctx, userId, userText)
})

export { bot }
