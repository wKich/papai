import { type ModelMessage } from 'ai'

import { getConfig } from './config.js'
import { logger } from './logger.js'
import { buildMemoryContextMessage, loadFacts, loadSummary, saveSummary, trimWithMemoryModel } from './memory.js'

const log = logger.child({ scope: 'conversation' })

// Working memory limits - based on typical LLM context window constraints
// WORKING_MEMORY_CAP: Hard ceiling to prevent unbounded token growth (100 messages ≈ 10-20k tokens)
// TRIM_MIN/TRIM_MAX: Range for smart trim - keeps enough context (50) while allowing flexibility (100)
// SMART_TRIM_INTERVAL: Trigger trim every N user messages to balance cost vs. relevance
const WORKING_MEMORY_CAP = 100
const TRIM_MIN = 50
const TRIM_MAX = 100
const SMART_TRIM_INTERVAL = 10

type MessagesWithMemory = { messages: ModelMessage[]; memoryMsg: { role: 'system'; content: string } | null }

export const buildMessagesWithMemory = (userId: number, history: readonly ModelMessage[]): MessagesWithMemory => {
  const summary = loadSummary(userId)
  const facts = loadFacts(userId)
  const memoryMsg = buildMemoryContextMessage(summary, facts)
  return { messages: memoryMsg === null ? [...history] : [memoryMsg, ...history], memoryMsg }
}

export const trimAndSummarise = async (
  history: readonly ModelMessage[],
  userId: number,
): Promise<readonly ModelMessage[]> => {
  log.debug({ userId, historyLength: history.length }, 'trimAndSummarise called')

  const userMessageCount = history.filter((m) => m.role === 'user').length
  const periodicTrim = userMessageCount > 0 && userMessageCount % SMART_TRIM_INTERVAL === 0 && history.length > TRIM_MIN
  const hardCapTrim = history.length >= WORKING_MEMORY_CAP

  if (!periodicTrim && !hardCapTrim) {
    return history
  }

  const reason = hardCapTrim ? 'hard cap reached' : `periodic (${userMessageCount} user messages)`
  log.warn({ userId, historyLength: history.length, reason }, 'Smart trim triggered')

  const openaiKey = getConfig(userId, 'openai_key')
  const openaiBaseUrl = getConfig(userId, 'openai_base_url')
  const openaiModel = getConfig(userId, 'openai_model')
  const memoryModel = getConfig(userId, 'memory_model') ?? openaiModel

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

  return history.slice(-WORKING_MEMORY_CAP)
}
