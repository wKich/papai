import { type ModelMessage } from 'ai'

import { getCachedConfig, getCachedHistory, setCachedHistory } from './cache.js'
import { logger } from './logger.js'
import { buildMemoryContextMessage, loadFacts, loadSummary, saveSummary, trimWithMemoryModel } from './memory.js'

const log = logger.child({ scope: 'conversation' })

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

export const shouldTriggerTrim = (history: readonly ModelMessage[]): boolean => {
  const userMessageCount = history.filter((m) => m.role === 'user').length
  const periodicTrim = userMessageCount > 0 && userMessageCount % SMART_TRIM_INTERVAL === 0 && history.length > TRIM_MIN
  const hardCapTrim = history.length >= WORKING_MEMORY_CAP
  return periodicTrim || hardCapTrim
}

export const runTrimInBackground = async (userId: number, history: readonly ModelMessage[]): Promise<void> => {
  const userMessageCount = history.filter((m) => m.role === 'user').length
  const reason =
    history.length >= WORKING_MEMORY_CAP ? 'hard cap reached' : `periodic (${userMessageCount} user messages)`
  log.warn({ userId, historyLength: history.length, reason }, 'Smart trim triggered (running in background)')

  const llmApiKey = getCachedConfig(userId, 'llm_apikey')
  const llmBaseUrl = getCachedConfig(userId, 'llm_baseurl')
  const mainModel = getCachedConfig(userId, 'main_model')
  const smallModel = getCachedConfig(userId, 'small_model') ?? mainModel

  if (llmApiKey !== null && llmBaseUrl !== null && smallModel !== null) {
    try {
      const existing = loadSummary(userId)
      const { trimmedMessages, summary } = await trimWithMemoryModel(history, TRIM_MIN, TRIM_MAX, existing, {
        apiKey: llmApiKey,
        baseUrl: llmBaseUrl,
        model: smallModel,
      })
      // Preserve any messages added to history while the async trim was running
      const currentHistory = getCachedHistory(userId)
      const newMessages = currentHistory.slice(history.length)
      saveSummary(userId, summary)
      setCachedHistory(userId, [...trimmedMessages, ...newMessages])
      log.info({ userId, retained: trimmedMessages.length, preserved: newMessages.length }, 'Smart trim complete')
    } catch (error) {
      log.warn(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Smart trim failed in background',
      )
    }
  } else {
    log.warn({ userId }, 'LLM config not available for background trim')
  }
}

export const getOrCreateHistory = (userId: number): readonly ModelMessage[] => {
  log.debug({ userId }, 'getOrCreateHistory called')
  const history = getCachedHistory(userId)
  log.debug({ userId, messageCount: history.length }, 'Conversation history loaded from cache')
  if (history.length === 0) {
    log.info({ userId }, 'No existing conversation history')
  }
  return history
}

export const trimAndSummarise = (history: readonly ModelMessage[], userId: number): readonly ModelMessage[] => {
  log.debug({ userId, historyLength: history.length }, 'trimAndSummarise called (now non-blocking)')

  if (!shouldTriggerTrim(history)) {
    return history
  }

  // Run trim in background without blocking
  void runTrimInBackground(userId, history)

  // Return current history immediately
  return history
}
