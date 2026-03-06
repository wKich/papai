import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { APICallError } from '@ai-sdk/provider'
import { generateText, stepCountIs } from 'ai'
import { type ModelMessage } from 'ai'
import { Bot, type Context } from 'grammy'

import { CONFIG_KEYS, getAllConfig, getConfig, isConfigKey, maskValue, setConfig } from './config.js'
import { getUserMessage, isAppError } from './errors.js'
import { clearHistory, loadHistory, saveHistory } from './history.js'
import { logger } from './logger.js'
import {
  buildMemoryContextMessage,
  clearFacts,
  clearSummary,
  extractFactsFromSdkResults,
  loadFacts,
  loadSummary,
  saveSummary,
  trimWithMemoryModel,
  upsertFact,
} from './memory.js'
import { makeTools } from './tools/index.js'

const log = logger.child({ scope: 'bot' })

const SYSTEM_PROMPT = `You are papai, a personal assistant that helps the user manage their Linear tasks directly from Telegram.

You can:
- Create new issues with titles, descriptions, priorities, and project associations
- Update issue statuses and assignees
- Search for issues by keyword or state
- List available teams and projects
- Fetch full details of a specific issue
- Add and read comments on issues
- Create labels, list available labels, view labels on an issue; apply or remove labels when creating/updating
- Set due dates and estimates on issues
- Create and read issue relations (blocks, duplicate, related)
- Create new projects
- Archive issues

Always confirm actions to the user in a friendly, concise manner. \
When creating or updating tasks, summarize what was done and include the issue identifier and URL if available. \
If you need context (like project IDs), call list_projects first.`

const bot = new Bot(process.env['TELEGRAM_BOT_TOKEN']!)
const allowedUserId = parseInt(process.env['TELEGRAM_USER_ID']!, 10)

const checkAuthorization = (userId: number | undefined): userId is number => {
  log.debug({ userId, allowedUserId }, 'Checking authorization')
  if (userId === undefined || userId !== allowedUserId) {
    if (userId !== undefined) {
      log.warn({ attemptedUserId: userId }, 'Unauthorized access attempt')
    }
    return false
  }
  return true
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

// Working memory limits
const WORKING_MEMORY_CAP = 100
const TRIM_MIN = 50
const TRIM_MAX = 100
const SMART_TRIM_INTERVAL = 10

const trimAndSummarise = async (history: readonly ModelMessage[], userId: number): Promise<readonly ModelMessage[]> => {
  log.debug({ userId, historyLength: history.length }, 'trimAndSummarise called')

  const userMessageCount = history.filter((m) => m.role === 'user').length
  const periodicTrim = userMessageCount > 0 && userMessageCount % SMART_TRIM_INTERVAL === 0 && history.length > TRIM_MIN
  const hardCapTrim = history.length >= WORKING_MEMORY_CAP

  if (!periodicTrim && !hardCapTrim) {
    return history
  }

  const reason = hardCapTrim ? 'hard cap reached' : `periodic (${userMessageCount} user messages)`
  log.warn({ userId, historyLength: history.length, reason }, 'Smart trim triggered')

  const openaiKey = getConfig('openai_key')
  const openaiBaseUrl = getConfig('openai_base_url')
  const openaiModel = getConfig('openai_model')
  // Use dedicated memory_model if configured; fall back to the main model.
  const memoryModel = getConfig('memory_model') ?? openaiModel

  if (openaiKey !== null && openaiBaseUrl !== null && memoryModel !== null) {
    try {
      const existing = loadSummary(userId)
      const { trimmedMessages, summary } = await trimWithMemoryModel(history, TRIM_MIN, TRIM_MAX, existing, {
        apiKey: openaiKey,
        baseUrl: openaiBaseUrl,
        model: memoryModel,
      })
      saveSummary(userId, summary)
      log.info({ userId, retained: trimmedMessages.length }, 'Smart trim complete')
      return trimmedMessages
    } catch (error) {
      log.warn(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Smart trim failed — falling back to positional slice',
      )
    }
  } else {
    log.warn({ userId }, 'LLM config not available — falling back to positional slice')
  }

  // Fallback: keep the most recent messages within hard limit
  return history.slice(-WORKING_MEMORY_CAP)
}

const buildOpenAI = (apiKey: string, baseURL: string): ReturnType<typeof createOpenAICompatible> =>
  createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL })

const checkRequiredConfig = (): string[] => {
  const requiredKeys = ['openai_key', 'openai_base_url', 'openai_model', 'linear_key', 'linear_team_id'] as const
  return requiredKeys.filter((k) => getConfig(k) === null)
}

type MessagesWithMemory = { messages: ModelMessage[]; memoryMsg: { role: 'system'; content: string } | null }

const buildMessagesWithMemory = (userId: number, history: readonly ModelMessage[]): MessagesWithMemory => {
  const summary = loadSummary(userId)
  const facts = loadFacts(userId)
  const memoryMsg = buildMemoryContextMessage(summary, facts)
  return { messages: memoryMsg === null ? [...history] : [memoryMsg, ...history], memoryMsg }
}

const persistFactsFromResults = (
  userId: number,
  toolCalls: Array<{ toolName: string; input: unknown }>,
  toolResults: Array<{ toolName: string; output: unknown }>,
): void => {
  const newFacts = extractFactsFromSdkResults(toolCalls, toolResults)
  for (const fact of newFacts) {
    upsertFact(userId, fact)
  }
  if (newFacts.length > 0) {
    log.info({ userId, factsExtracted: newFacts.length }, 'Facts extracted and persisted')
  }
}

const callLlm = async (ctx: Context, userId: number, history: readonly ModelMessage[]): Promise<void> => {
  const missing = checkRequiredConfig()
  if (missing.length > 0) {
    log.warn({ userId, missing }, 'Missing required config keys')
    await ctx.reply(`Missing configuration: ${missing.join(', ')}.\nUse /set <key> <value> to configure.`)
    return
  }

  const openaiKey = getConfig('openai_key')!
  const openaiBaseUrl = getConfig('openai_base_url')!
  const openaiModel = getConfig('openai_model')!
  const linearKey = getConfig('linear_key')!
  const linearTeamId = getConfig('linear_team_id')!
  const model = buildOpenAI(openaiKey, openaiBaseUrl)(openaiModel)
  const tools = makeTools({ linearKey, linearTeamId })

  const { messages: messagesWithMemory, memoryMsg } = buildMessagesWithMemory(userId, history)

  log.debug({ userId, historyLength: history.length, hasMemory: memoryMsg !== null }, 'Calling generateText')
  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    messages: messagesWithMemory,
    tools,
    stopWhen: stepCountIs(25),
  })

  log.debug({ userId, toolCalls: result.toolCalls?.length, usage: result.usage }, 'LLM response received')
  persistFactsFromResults(userId, result.toolCalls, result.toolResults)

  const assistantText = result.text
  saveHistory(userId, [...history, ...result.response.messages])
  await ctx.reply(assistantText || 'Done.')
  log.info(
    { userId, responseLength: assistantText?.length ?? 0, toolCalls: result.toolCalls?.length ?? 0 },
    'Response sent successfully',
  )
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
  log.info({ userId, key }, '/set command executed')
  await ctx.reply(`Set ${key} successfully.`)
})

bot.command('config', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAuthorization(userId)) {
    return
  }

  log.debug({ userId }, '/config command called')
  const config = getAllConfig()
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
  if (!checkAuthorization(userId)) {
    return
  }
  log.debug({ userId }, '/clear command called')
  clearHistory(userId)
  clearSummary(userId)
  clearFacts(userId)
  log.info({ userId }, '/clear command executed — all memory tiers cleared')
  await ctx.reply('Conversation history and memory cleared.')
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
