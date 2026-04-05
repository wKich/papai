import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs, type ModelMessage } from 'ai'

import { getCachedHistory } from '../cache.js'
import { getConfig } from '../config.js'
import { buildMessagesWithMemory, runTrimInBackground, shouldTriggerTrim } from '../conversation.js'
import { appendHistory } from '../history.js'
import { logger } from '../logger.js'
import { extractFactsFromSdkResults, upsertFact } from '../memory.js'
import type { TaskProvider } from '../providers/types.js'
import { buildSystemPrompt } from '../system-prompt.js'
import { makeTools } from '../tools/index.js'
import { buildProactiveTrigger, formatLocalTime } from './proactive-trigger.js'
import type { ExecutionMetadata } from './types.js'

const log = logger.child({ scope: 'deferred:proactive-llm' })

export interface ProactiveLlmDeps {
  generateText: typeof generateText
  stepCountIs: typeof stepCountIs
  buildModel: (
    config: { apiKey: string; baseURL: string },
    modelId: string,
  ) => ReturnType<ReturnType<typeof createOpenAICompatible>>
}

const defaultProactiveLlmDeps: ProactiveLlmDeps = {
  generateText: (...args) => generateText(...args),
  stepCountIs: (...args) => stepCountIs(...args),
  buildModel: (config, modelId) => createOpenAICompatible({ name: 'openai-compatible', ...config })(modelId),
}

export type BuildProviderFn = (userId: string) => TaskProvider | null

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
    return 'Deferred prompt skipped: missing LLM configuration. Use /setup to configure llm_apikey, llm_baseurl, and main_model.'
  }
  return { apiKey, baseURL, mainModel }
}

type LlmResult = Awaited<ReturnType<typeof generateText>>

function persistProactiveResults(userId: string, result: LlmResult, history: readonly ModelMessage[]): void {
  const newFacts = extractFactsFromSdkResults(result.toolCalls, result.toolResults)
  for (const fact of newFacts) upsertFact(userId, fact)
  if (newFacts.length > 0)
    log.info({ userId, factsExtracted: newFacts.length }, 'Facts persisted from proactive results')

  const msgs = result.response.messages
  if (msgs.length > 0) {
    appendHistory(userId, msgs)
    const updated = [...history, ...msgs]
    if (shouldTriggerTrim(updated)) void runTrimInBackground(userId, updated)
  }
  log.debug({ userId, toolCalls: result.toolCalls?.length }, 'Proactive LLM response received')
}

// --- Minimal system prompt (shared by lightweight and context modes) ---

function buildMinimalSystemPrompt(type: 'scheduled' | 'alert', timezone: string): string {
  const { currentTime, displayTimezone } = formatLocalTime(timezone)
  return [
    '[PROACTIVE EXECUTION]',
    `Current time: ${currentTime} (${displayTimezone})`,
    `Trigger type: ${type}`,
    '',
    'A deferred prompt has fired. Deliver the result warmly and conversationally.',
    'Do not mention scheduling, triggers, or system events.',
    'Do not create new deferred prompts.',
  ].join('\n')
}

// --- Message construction helpers ---

function buildMetadataMessages(m: ExecutionMetadata): ModelMessage[] {
  const msgs: ModelMessage[] = [{ role: 'system', content: `[DELIVERY BRIEF]\n${m.delivery_brief}` }]
  if (m.context_snapshot !== null)
    msgs.push({ role: 'system', content: `[CONTEXT FROM CREATION TIME]\n${m.context_snapshot}` })
  return msgs
}

const wrapPrompt = (prompt: string): string => `===DEFERRED_TASK===\n${prompt}\n===END_DEFERRED_TASK===`

// --- Three execution functions ---

async function invokeLightweight(
  userId: string,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
  deps: ProactiveLlmDeps,
): Promise<string> {
  log.debug({ userId, mode: 'lightweight' }, 'invokeLightweight called')
  const config = getLlmConfig(userId)
  if (typeof config === 'string') return config

  const smallModel = getConfig(userId, 'small_model')
  const modelId = smallModel ?? config.mainModel
  const model = deps.buildModel(config, modelId)
  const timezone = getConfig(userId, 'timezone') ?? 'UTC'
  const messages: ModelMessage[] = [...buildMetadataMessages(metadata), { role: 'user', content: wrapPrompt(prompt) }]

  log.debug({ userId, modelId, mode: 'lightweight' }, 'Calling generateText')
  const result = await deps.generateText({ model, system: buildMinimalSystemPrompt(type, timezone), messages })

  const assistantMessages = result.response.messages
  if (assistantMessages.length > 0) {
    const history = getCachedHistory(userId)
    appendHistory(userId, assistantMessages)
    log.debug({ userId, count: assistantMessages.length }, 'Lightweight response appended to history')
    const updatedHistory = [...history, ...assistantMessages]
    if (shouldTriggerTrim(updatedHistory)) void runTrimInBackground(userId, updatedHistory)
  }
  return result.text ?? 'Done.'
}

async function invokeWithContext(
  userId: string,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
  deps: ProactiveLlmDeps,
): Promise<string> {
  log.debug({ userId, mode: 'context' }, 'invokeWithContext called')
  const config = getLlmConfig(userId)
  if (typeof config === 'string') return config

  const model = deps.buildModel(config, config.mainModel)
  const timezone = getConfig(userId, 'timezone') ?? 'UTC'
  const history = getCachedHistory(userId)
  const { messages: messagesWithMemory } = buildMessagesWithMemory(userId, history)
  const messages: ModelMessage[] = [
    ...messagesWithMemory,
    ...buildMetadataMessages(metadata),
    { role: 'user', content: wrapPrompt(prompt) },
  ]

  log.debug({ userId, mainModel: config.mainModel, historyLength: history.length, mode: 'context' }, 'generateText')
  const result = await deps.generateText({ model, system: buildMinimalSystemPrompt(type, timezone), messages })

  const assistantMessages = result.response.messages
  if (assistantMessages.length > 0) {
    appendHistory(userId, assistantMessages)
    const updatedHistory = [...history, ...assistantMessages]
    if (shouldTriggerTrim(updatedHistory)) void runTrimInBackground(userId, updatedHistory)
  }
  return result.text ?? 'Done.'
}

async function invokeFull(
  userId: string,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
  buildProviderFn: BuildProviderFn,
  matchedTasksSummary: string | undefined,
  deps: ProactiveLlmDeps,
): Promise<string> {
  log.debug({ userId, mode: 'full' }, 'invokeFull called')
  const config = getLlmConfig(userId)
  if (typeof config === 'string') return config

  const provider = buildProviderFn(userId)
  if (provider === null) {
    log.warn({ userId }, 'Could not build task provider for deferred prompt')
    return 'Deferred prompt skipped: task provider not configured.'
  }

  const model = deps.buildModel(config, config.mainModel)
  const tools = makeTools(provider, userId, 'proactive')
  const timezone = getConfig(userId, 'timezone') ?? 'UTC'
  const systemPrompt = buildSystemPrompt(provider, timezone, userId)
  const trigger = buildProactiveTrigger(type, prompt, timezone, matchedTasksSummary)
  const history = getCachedHistory(userId)
  const { messages: messagesWithMemory } = buildMessagesWithMemory(userId, history)
  const finalMessages: ModelMessage[] = [
    ...messagesWithMemory,
    { role: 'system', content: trigger.systemContext },
    ...buildMetadataMessages(metadata),
    { role: 'user', content: trigger.userContent },
  ]

  log.debug({ userId, mainModel: config.mainModel, historyLength: history.length, mode: 'full' }, 'generateText')
  const result = await deps.generateText({
    model,
    system: systemPrompt,
    messages: finalMessages,
    tools,
    stopWhen: deps.stepCountIs(25),
  })
  persistProactiveResults(userId, result, history)
  return result.text ?? 'Done.'
}

// --- Dispatcher ---

export function dispatchExecution(
  userId: string,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
  buildProviderFn: BuildProviderFn,
  matchedTasksSummary?: string,
  deps: ProactiveLlmDeps = defaultProactiveLlmDeps,
): Promise<string> {
  log.debug({ userId, mode: metadata.mode }, 'dispatchExecution called')
  switch (metadata.mode) {
    case 'lightweight':
      return invokeLightweight(userId, type, prompt, metadata, deps)
    case 'context':
      return invokeWithContext(userId, type, prompt, metadata, deps)
    case 'full':
      return invokeFull(userId, type, prompt, metadata, buildProviderFn, matchedTasksSummary, deps)
  }
}
