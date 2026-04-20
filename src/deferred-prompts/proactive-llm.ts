import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai'

import { getCachedHistory } from '../cache.js'
import type { DeferredDeliveryTarget } from '../chat/types.js'
import { getConfig } from '../config.js'
import { buildMessagesWithMemory, runTrimInBackground, shouldTriggerTrim } from '../conversation.js'
import { appendHistory } from '../history.js'
import { logger } from '../logger.js'
import { extractFactsFromSdkResults, upsertFact } from '../memory.js'
import type { TaskProvider } from '../providers/types.js'
import { buildSystemPrompt } from '../system-prompt.js'
import { makeGetCurrentTimeTool } from '../tools/get-current-time.js'
import { makeTools } from '../tools/index.js'
import { buildProactiveTrigger } from './proactive-trigger.js'
import type { ExecutionMetadata } from './types.js'

const log = logger.child({ scope: 'deferred:proactive-llm' })

/** Execution context for a deferred prompt: who created it and where to deliver. */
export type DeferredExecutionContext = {
  createdByUserId: string
  deliveryTarget: DeferredDeliveryTarget
}

const makeMinimalTools = (userId: string): { get_current_time: ReturnType<typeof makeGetCurrentTimeTool> } => ({
  get_current_time: makeGetCurrentTimeTool(userId),
})

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

const getStorageContextId = (target: DeferredDeliveryTarget): string =>
  target.contextType === 'group' && target.threadId !== null
    ? `${target.contextId}:${target.threadId}`
    : target.contextId

type LlmResult = Awaited<ReturnType<typeof generateText>>

function persistProactiveResults(
  creatorId: string,
  storageContextId: string,
  result: LlmResult,
  history: readonly ModelMessage[],
): void {
  const newFacts = extractFactsFromSdkResults(result.toolCalls, result.toolResults)
  for (const fact of newFacts) upsertFact(storageContextId, fact)
  if (newFacts.length > 0)
    log.info(
      { userId: creatorId, storageContextId, factsExtracted: newFacts.length },
      'Facts persisted from proactive results',
    )

  const msgs = result.response.messages
  if (msgs.length > 0) {
    appendHistory(storageContextId, msgs)
    const updated = [...history, ...msgs]
    if (shouldTriggerTrim(updated)) void runTrimInBackground(storageContextId, updated)
  }
  log.debug({ userId: creatorId, toolCalls: result.toolCalls?.length }, 'Proactive LLM response received')
}

function buildMinimalSystemPrompt(type: 'scheduled' | 'alert'): string {
  return [
    '[PROACTIVE EXECUTION]',
    `Trigger type: ${type}`,
    '',
    'A deferred prompt has fired. Deliver the result warmly and conversationally.',
    'Do not mention scheduling, triggers, or system events.',
    'Do not create new deferred prompts.',
  ].join('\n')
}

function buildMetadataMessages(m: ExecutionMetadata): ModelMessage[] {
  const msgs: ModelMessage[] = [{ role: 'system', content: `[DELIVERY BRIEF]\n${m.delivery_brief}` }]
  if (m.context_snapshot !== null)
    msgs.push({ role: 'system', content: `[CONTEXT FROM CREATION TIME]\n${m.context_snapshot}` })
  return msgs
}

const wrapPrompt = (prompt: string): string => `===DEFERRED_TASK===\n${prompt}\n===END_DEFERRED_TASK===`

async function invokeLightweight(
  execCtx: DeferredExecutionContext,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
  deps: ProactiveLlmDeps,
): Promise<string> {
  const { createdByUserId, deliveryTarget } = execCtx
  const storageContextId = getStorageContextId(deliveryTarget)
  log.debug({ userId: createdByUserId, mode: 'lightweight' }, 'invokeLightweight called')
  const config = getLlmConfig(createdByUserId)
  if (typeof config === 'string') return config

  const smallModel = getConfig(createdByUserId, 'small_model')
  const modelId = smallModel ?? config.mainModel
  const model = deps.buildModel(config, modelId)
  const messages: ModelMessage[] = [...buildMetadataMessages(metadata), { role: 'user', content: wrapPrompt(prompt) }]

  log.debug({ userId: createdByUserId, modelId, mode: 'lightweight' }, 'Calling generateText')
  const result = await deps.generateText({
    model,
    system: buildMinimalSystemPrompt(type),
    messages,
    tools: makeMinimalTools(createdByUserId),
    timeout: 1_200_000,
  })

  const assistantMessages = result.response.messages
  if (assistantMessages.length > 0) {
    const history = getCachedHistory(storageContextId)
    appendHistory(storageContextId, assistantMessages)
    log.debug(
      { userId: createdByUserId, storageContextId, count: assistantMessages.length },
      'Lightweight response appended to history',
    )
    const updatedHistory = [...history, ...assistantMessages]
    if (shouldTriggerTrim(updatedHistory)) void runTrimInBackground(storageContextId, updatedHistory)
  }
  return result.text ?? 'Done.'
}

async function invokeWithContext(
  execCtx: DeferredExecutionContext,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
  deps: ProactiveLlmDeps,
): Promise<string> {
  const { createdByUserId, deliveryTarget } = execCtx
  const storageContextId = getStorageContextId(deliveryTarget)
  log.debug({ userId: createdByUserId, mode: 'context' }, 'invokeWithContext called')
  const config = getLlmConfig(createdByUserId)
  if (typeof config === 'string') return config

  const model = deps.buildModel(config, config.mainModel)
  const history = getCachedHistory(storageContextId)
  const { messages: messagesWithMemory } = buildMessagesWithMemory(storageContextId, history)
  const messages: ModelMessage[] = [
    ...messagesWithMemory,
    ...buildMetadataMessages(metadata),
    { role: 'user', content: wrapPrompt(prompt) },
  ]

  log.debug(
    { userId: createdByUserId, mainModel: config.mainModel, historyLength: history.length, mode: 'context' },
    'generateText',
  )
  const result = await deps.generateText({
    model,
    system: buildMinimalSystemPrompt(type),
    messages,
    tools: makeMinimalTools(createdByUserId),
    timeout: 1_200_000,
  })

  const assistantMessages = result.response.messages
  if (assistantMessages.length > 0) {
    appendHistory(storageContextId, assistantMessages)
    const updatedHistory = [...history, ...assistantMessages]
    if (shouldTriggerTrim(updatedHistory)) void runTrimInBackground(storageContextId, updatedHistory)
  }
  return result.text ?? 'Done.'
}

function buildFullToolSet(
  provider: TaskProvider,
  createdByUserId: string,
  storageContextId: string,
  contextType: 'dm' | 'group',
): ToolSet {
  return makeTools(provider, {
    storageContextId,
    chatUserId: createdByUserId,
    mode: 'proactive',
    contextType,
  })
}

function buildFullMessages(
  createdByUserId: string,
  storageContextId: string,
  type: 'scheduled' | 'alert',
  prompt: string,
  matchedTasksSummary: string | undefined,
  metadata: ExecutionMetadata,
): { messages: ModelMessage[]; systemPrompt: string } {
  const timezone = getConfig(createdByUserId, 'timezone') ?? 'UTC'
  const trigger = buildProactiveTrigger(type, prompt, timezone, matchedTasksSummary)
  const history = getCachedHistory(storageContextId)
  const { messages: messagesWithMemory } = buildMessagesWithMemory(storageContextId, history)
  return {
    messages: [
      ...messagesWithMemory,
      { role: 'system', content: trigger.systemContext },
      ...buildMetadataMessages(metadata),
      { role: 'user', content: trigger.userContent },
    ],
    systemPrompt: trigger.systemContext,
  }
}

async function invokeFull(
  execCtx: DeferredExecutionContext,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
  buildProviderFn: BuildProviderFn,
  matchedTasksSummary: string | undefined,
  deps: ProactiveLlmDeps,
): Promise<string> {
  const { createdByUserId, deliveryTarget } = execCtx
  const storageContextId = getStorageContextId(deliveryTarget)
  log.debug({ userId: createdByUserId, mode: 'full' }, 'invokeFull called')
  const config = getLlmConfig(createdByUserId)
  if (typeof config === 'string') return config

  const provider = buildProviderFn(createdByUserId)
  if (provider === null) {
    log.warn({ userId: createdByUserId }, 'Could not build task provider for deferred prompt')
    return 'Deferred prompt skipped: task provider not configured.'
  }

  const model = deps.buildModel(config, config.mainModel)
  const tools = buildFullToolSet(provider, createdByUserId, storageContextId, deliveryTarget.contextType)
  const systemPrompt = buildSystemPrompt(provider, createdByUserId)
  const { messages } = buildFullMessages(createdByUserId, storageContextId, type, prompt, matchedTasksSummary, metadata)

  log.debug(
    { userId: createdByUserId, mainModel: config.mainModel, historyLength: messages.length, mode: 'full' },
    'generateText',
  )
  const result = await deps.generateText({
    model,
    system: systemPrompt,
    messages,
    tools,
    stopWhen: deps.stepCountIs(25),
    timeout: 1_200_000,
  })
  persistProactiveResults(createdByUserId, storageContextId, result, getCachedHistory(storageContextId))
  return result.text ?? 'Done.'
}

export function dispatchExecution(
  execCtx: DeferredExecutionContext,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
  buildProviderFn: BuildProviderFn,
  matchedTasksSummary?: string,
  deps: ProactiveLlmDeps = defaultProactiveLlmDeps,
): Promise<string> {
  const { createdByUserId } = execCtx
  log.debug({ userId: createdByUserId, mode: metadata.mode }, 'dispatchExecution called')
  switch (metadata.mode) {
    case 'lightweight':
      return invokeLightweight(execCtx, type, prompt, metadata, deps)
    case 'context':
      return invokeWithContext(execCtx, type, prompt, metadata, deps)
    case 'full':
      return invokeFull(execCtx, type, prompt, metadata, buildProviderFn, matchedTasksSummary, deps)
    default:
      return invokeFull(execCtx, type, prompt, metadata, buildProviderFn, matchedTasksSummary, deps)
  }
}
