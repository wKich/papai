import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs, type ModelMessage } from 'ai'

import { getCachedHistory } from '../cache.js'
import { getConfig } from '../config.js'
import { buildMessagesWithMemory } from '../conversation.js'
import { appendHistory } from '../history.js'
import { logger } from '../logger.js'
import { extractFactsFromSdkResults, upsertFact } from '../memory.js'
import type { TaskProvider } from '../providers/types.js'
import { buildSystemPrompt } from '../system-prompt.js'
import { makeTools } from '../tools/index.js'

const log = logger.child({ scope: 'deferred:proactive-llm' })

export type BuildProviderFn = (userId: string) => TaskProvider | null

export type ProactiveTrigger = {
  /** System-level context (time, type, behavioral instructions). No user-authored text. */
  systemContext: string
  /** User-scoped content: the original prompt and any matched task data. */
  userContent: string
}

/**
 * Build a proactive trigger split into system context and user content.
 * User-authored text stays in userContent to avoid system-prompt elevation.
 */
export function buildProactiveTrigger(
  type: 'scheduled' | 'alert',
  prompt: string,
  timezone: string,
  matchedTasksSummary?: string,
): ProactiveTrigger {
  const currentTime = new Date().toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const systemLines = [
    '[PROACTIVE EXECUTION]',
    `Current time: ${currentTime} (${timezone})`,
    `Task type: ${type}`,
    '',
    'You are proactively reaching out to the user to fulfill this task.',
    'Do not mention system events, triggers, cron jobs, or scheduled tasks.',
    'Act naturally, as if you just remembered or noticed something relevant.',
    'Keep the tone conversational and directly address the task.',
    'If the task requires action (not just a reminder), use available tools.',
  ]

  const userLines = [prompt]

  if (matchedTasksSummary !== undefined) {
    userLines.push('', 'Matched tasks:', matchedTasksSummary)
  }

  return {
    systemContext: systemLines.join('\n'),
    userContent: userLines.join('\n'),
  }
}

type LlmConfig = { apiKey: string; baseURL: string; mainModel: string }

function getLlmConfig(userId: string): LlmConfig | string {
  const apiKey = getConfig(userId, 'llm_apikey')
  const baseURL = getConfig(userId, 'llm_baseurl')
  const mainModel = getConfig(userId, 'main_model')
  if (apiKey === null || baseURL === null || mainModel === null) {
    log.warn(
      { userId, hasApiKey: apiKey !== null, hasBaseUrl: baseURL !== null, hasModel: mainModel !== null },
      'Missing LLM config for deferred prompt',
    )
    return 'Deferred prompt skipped: missing LLM configuration. Use /set to configure llm_apikey, llm_baseurl, and main_model.'
  }
  return { apiKey, baseURL, mainModel }
}

type LlmResult = Awaited<ReturnType<typeof generateText>>

function persistProactiveResults(userId: string, result: LlmResult): void {
  const newFacts = extractFactsFromSdkResults(result.toolCalls, result.toolResults)
  if (newFacts.length > 0) {
    for (const fact of newFacts) upsertFact(userId, fact)
    log.info({ userId, factsExtracted: newFacts.length }, 'Facts persisted from proactive tool results')
  }

  if (result.response.messages.length > 0) {
    appendHistory(userId, result.response.messages)
    log.debug({ userId, count: result.response.messages.length }, 'Proactive response appended to history')
  }

  log.debug({ userId, toolCalls: result.toolCalls?.length }, 'Proactive LLM response received')
}

/**
 * Invoke the LLM with the user's full conversation history and a proactive trigger.
 * The system context is injected as a system message; the user-authored prompt is
 * injected as a user message to avoid elevating untrusted text to system priority.
 * Neither is saved to history.
 */
export async function invokeLlmWithHistory(
  userId: string,
  trigger: ProactiveTrigger,
  buildProviderFn: BuildProviderFn,
): Promise<string> {
  log.debug({ userId }, 'invokeLlmWithHistory called')

  const config = getLlmConfig(userId)
  if (typeof config === 'string') return config

  const provider = buildProviderFn(userId)
  if (provider === null) {
    log.warn({ userId }, 'Could not build task provider for deferred prompt')
    return 'Deferred prompt skipped: task provider not configured.'
  }

  const model = createOpenAICompatible({ name: 'openai-compatible', ...config })(config.mainModel)
  const tools = makeTools(provider, userId)
  const timezone = getConfig(userId, 'timezone') ?? 'UTC'
  const systemPrompt = buildSystemPrompt(provider, timezone, userId)

  const history = getCachedHistory(userId)
  const { messages: messagesWithMemory } = buildMessagesWithMemory(userId, history)
  const finalMessages: ModelMessage[] = [
    ...messagesWithMemory,
    { role: 'system', content: trigger.systemContext },
    { role: 'user', content: trigger.userContent },
  ]

  log.debug({ userId, mainModel: config.mainModel, historyLength: history.length }, 'Calling generateText')
  const result = await generateText({
    model,
    system: systemPrompt,
    messages: finalMessages,
    tools,
    stopWhen: stepCountIs(25),
  })

  persistProactiveResults(userId, result)
  return result.text ?? 'Done.'
}
