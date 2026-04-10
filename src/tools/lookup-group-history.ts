import type { LanguageModel, ModelMessage } from 'ai'
import { generateText } from 'ai'

import { getCachedConfig, getCachedHistory } from '../cache.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tools:lookup-group-history' })

type GenerateTextResult = {
  text: string
}

export type LookupGroupHistoryDeps = {
  getCachedHistory: typeof getCachedHistory
  generateText: (options: {
    model: LanguageModel
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  }) => Promise<GenerateTextResult>
  getSmallModel: (userId: string) => LanguageModel | null
}

const defaultDeps: LookupGroupHistoryDeps = {
  getCachedHistory,
  generateText: async (options) => {
    const result = await generateText(options)
    return { text: result.text }
  },
  getSmallModel: (userId: string) => {
    const llmApiKey = getCachedConfig(userId, 'llm_apikey')
    const llmBaseUrl = getCachedConfig(userId, 'llm_baseurl')
    const smallModel = getCachedConfig(userId, 'small_model')

    if (llmApiKey === null || llmBaseUrl === null || smallModel === null) {
      return null
    }

    const { createOpenAICompatible } = require('@ai-sdk/openai-compatible')
    return createOpenAICompatible({ name: 'openai-compatible', apiKey: llmApiKey, baseURL: llmBaseUrl })(smallModel)
  },
}

/**
 * Search the main group chat for specific information using AI.
 * Uses small_model to extract relevant information from main chat history.
 */
export async function executeLookupGroupHistory(
  userId: string,
  groupId: string,
  queries: string[],
  deps: LookupGroupHistoryDeps = defaultDeps,
): Promise<string> {
  log.debug({ userId, groupId, queries }, 'Executing lookup_group_history')

  // Load main chat history (not thread-scoped)
  const mainHistory = deps.getCachedHistory(groupId) as readonly ModelMessage[]

  if (mainHistory.length === 0) {
    return 'No messages found in the main chat.'
  }

  // Get small model for processing
  const smallModel = deps.getSmallModel(userId)
  if (smallModel === null) {
    log.warn({ userId }, 'No LLM config available for lookup_group_history')
    return 'Unable to search: LLM not configured.'
  }

  try {
    const result = await deps.generateText({
      model: smallModel,
      messages: [
        {
          role: 'system',
          content: 'You are searching through group chat history. Extract only the information relevant to the queries. Be concise and factual. If no relevant information is found, say "No relevant information found in main chat."',
        },
        {
          role: 'user',
          content: `Search queries: ${queries.join(', ')}

Chat history:
${mainHistory.map(m => `${m.role}: ${String(m.content)}`).join('\n')}

Provide a concise answer based only on the chat history.`,
        },
      ],
    })

    log.info({ userId, groupId, resultLength: result.text.length }, 'lookup_group_history completed')
    return result.text
  } catch (error) {
    log.error({ userId, groupId, error: error instanceof Error ? error.message : String(error) }, 'lookup_group_history failed')
    return 'Error searching main chat history.'
  }
}

/**
 * Tool definition for lookup_group_history
 */
export const lookupGroupHistoryTool = {
  name: 'lookup_group_history',
  description: 'Search the main group chat for specific information using AI. Use this when you need context from ongoing discussions outside the current thread, such as finding decisions, context, or references mentioned in the main chat.',
  parameters: {
    type: 'object',
    properties: {
      queries: {
        type: 'array',
        items: { type: 'string' },
        description: 'Search queries or topics to look for in the group context. Be specific about what you need to find.',
      },
    },
    required: ['queries'],
  },
}
