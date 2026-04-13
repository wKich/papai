import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai'

import { getCachedHistory, getCachedTools, setCachedTools } from './cache.js'
import type { ReplyFn } from './chat/types.js'
import { getConfig } from './config.js'
import { buildMessagesWithMemory, runTrimInBackground, shouldTriggerTrim } from './conversation.js'
import { emit } from './debug/event-bus.js'
import { appendHistory, saveHistory } from './history.js'
import { getIdentityMapping } from './identity/mapping.js'
import { attemptAutoLink } from './identity/resolver.js'
import { emitLlmEnd, emitLlmStart } from './llm-orchestrator-events.js'
import { handleOrchestratorMessageError, handleToolCallFinish } from './llm-orchestrator-support.js'
import type { InvokeModelArgs, LlmOrchestratorDeps } from './llm-orchestrator-types.js'
import { validateToolResults } from './llm-orchestrator-validation.js'
import { logger } from './logger.js'
import { extractFactsFromSdkResults, upsertFact } from './memory.js'
import { buildProviderForUser } from './providers/factory.js'
import { maybeProvisionKaneo } from './providers/kaneo/provision.js'
import type { TaskProvider } from './providers/types.js'
import { buildSystemPrompt } from './system-prompt.js'
import { makeTools } from './tools/index.js'
import { fetchWithoutTimeout } from './utils/fetch.js'

const log = logger.child({ scope: 'llm-orchestrator' })

const defaultDeps: LlmOrchestratorDeps = {
  generateText: (...args) => generateText(...args),
  stepCountIs: (...args) => stepCountIs(...args),
  buildOpenAI: (apiKey: string, baseURL: string) =>
    createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL, fetch: fetchWithoutTimeout }),
  buildProviderForUser: (userId: string) => buildProviderForUser(userId, true),
  maybeProvisionKaneo: (reply, contextId, username) => maybeProvisionKaneo(reply, contextId, username),
}

const TASK_PROVIDER = process.env['TASK_PROVIDER'] ?? 'kaneo'

const checkRequiredConfig = (contextId: string): string[] => {
  const llmKeys = ['llm_apikey', 'llm_baseurl', 'main_model'] as const
  const providerKeys = TASK_PROVIDER === 'youtrack' ? (['youtrack_token'] as const) : (['kaneo_apikey'] as const)
  return [...llmKeys, ...providerKeys].filter((k) => getConfig(contextId, k) === null)
}

interface LlmConfig {
  llmApiKey: string
  llmBaseUrl: string
  mainModel: string
}

const getLlmConfig = (contextId: string): LlmConfig => ({
  llmApiKey: getConfig(contextId, 'llm_apikey')!,
  llmBaseUrl: getConfig(contextId, 'llm_baseurl')!,
  mainModel: getConfig(contextId, 'main_model')!,
})

const persistFactsFromResults = (
  contextId: string,
  toolCalls: Array<{ toolName: string; input: unknown }>,
  toolResults: Array<{ toolName: string; output: unknown }>,
): void => {
  const newFacts = extractFactsFromSdkResults(toolCalls, toolResults)
  if (newFacts.length === 0) return
  for (const fact of newFacts) upsertFact(contextId, fact)
  log.info(
    { contextId, factsExtracted: newFacts.length, factsUpserted: newFacts.length },
    'Facts extracted and persisted',
  )
}

const isToolSet = (value: unknown): value is ToolSet =>
  typeof value === 'object' && value !== null && Object.keys(value).length > 0

const getOrCreateTools = (
  contextId: string,
  chatUserId: string,
  provider: TaskProvider,
  contextType: 'dm' | 'group' | undefined,
): ToolSet => {
  // Security fix: In group chats, tools embed chatUserId-specific closures for "me" resolution.
  // The cache key must include chatUserId to prevent cross-user contamination.
  const cacheKey = contextType === 'group' ? `${contextId}:${chatUserId}` : contextId
  const cachedTools = getCachedTools(cacheKey)
  if (cachedTools !== undefined && cachedTools !== null && isToolSet(cachedTools)) {
    log.debug({ contextId, chatUserId }, 'Using cached tools')
    return cachedTools
  }
  log.debug({ contextId, chatUserId }, 'Building tools (cache miss)')
  const tools = makeTools(provider, { storageContextId: contextId, chatUserId, contextType })
  setCachedTools(cacheKey, tools)
  return tools
}

const sendLlmResponse = async (
  reply: ReplyFn,
  contextId: string,
  result: { text?: string; toolCalls?: unknown[]; response: { messages: ModelMessage[] } },
): Promise<void> => {
  const textToFormat = result.text !== undefined && result.text !== '' ? result.text : 'Done.'
  await reply.formatted(textToFormat)
  log.info(
    { contextId, responseLength: result.text?.length ?? 0, toolCalls: result.toolCalls?.length ?? 0 },
    'Response sent successfully',
  )
}

const invokeModel = async (
  args: InvokeModelArgs & { reply?: ReplyFn },
): ReturnType<LlmOrchestratorDeps['generateText']> => {
  const { contextId, mainModel, model, provider, tools, messages, deps, reply } = args
  const start = Date.now()
  emitLlmStart(contextId, mainModel, messages, tools)
  const result = await deps.generateText({
    model,
    system: buildSystemPrompt(provider, contextId),
    messages,
    tools,
    timeout: 1_200_000,
    stopWhen: deps.stepCountIs(25),
    experimental_onToolCallStart(event) {
      emit('llm:tool_call', {
        userId: contextId,
        toolName: event.toolCall.toolName,
        toolCallId: event.toolCall.toolCallId,
        args: event.toolCall.input,
      })
    },
    experimental_onToolCallFinish(event) {
      handleToolCallFinish(contextId, reply, event)
    },
  })
  emitLlmEnd(contextId, mainModel, result, start, messages, tools)
  return result
}

const maybeAutoLinkIdentity = async (
  chatUserId: string,
  username: string | null,
  provider: TaskProvider,
): Promise<void> => {
  if (username === null || provider.identityResolver === undefined) return
  const existingMapping = getIdentityMapping(chatUserId, provider.name)
  if (existingMapping !== null) return
  log.debug({ chatUserId, username }, 'Attempting auto-link for first group interaction')
  const autoLinkResult = await attemptAutoLink(chatUserId, username, provider)
  if (autoLinkResult.type === 'found') {
    log.info({ chatUserId, login: autoLinkResult.identity.login }, 'Auto-linked user on first interaction')
  } else {
    log.debug({ chatUserId, username, result: autoLinkResult.type }, 'Auto-link did not find match')
  }
}

const callLlm = async (
  reply: ReplyFn,
  contextId: string,
  chatUserId: string,
  username: string | null,
  history: readonly ModelMessage[],
  contextType: 'dm' | 'group',
  deps: LlmOrchestratorDeps,
  configContextId?: string,
): Promise<{ response: { messages: ModelMessage[] } }> => {
  const configId = configContextId ?? contextId
  await deps.maybeProvisionKaneo(reply, configId, username)
  const missing = checkRequiredConfig(configId)
  if (missing.length > 0) {
    log.warn({ contextId, configId, missing }, 'Missing required config keys')
    await reply.text(`Missing configuration: ${missing.join(', ')}.\nUse /setup to configure.`)
    throw new Error('Missing configuration')
  }
  const { llmApiKey, llmBaseUrl, mainModel } = getLlmConfig(configId)
  const model = deps.buildOpenAI(llmApiKey, llmBaseUrl)(mainModel)
  const provider = deps.buildProviderForUser(configId)
  await maybeAutoLinkIdentity(chatUserId, username, provider)
  const tools = getOrCreateTools(contextId, chatUserId, provider, contextType)
  const timezone = getConfig(configId, 'timezone') ?? 'UTC'
  const { messages: messagesWithMemory, memoryMsg } = buildMessagesWithMemory(contextId, history)
  const validatedMessages = validateToolResults(messagesWithMemory)
  log.debug(
    { contextId, historyLength: history.length, hasMemory: memoryMsg !== null, timezone },
    'Calling generateText',
  )
  const result = await invokeModel({
    contextId,
    mainModel,
    model,
    provider,
    tools,
    messages: validatedMessages,
    deps,
    reply,
  })
  log.debug({ contextId, toolCalls: result.toolCalls?.length, usage: result.usage }, 'LLM response received')
  persistFactsFromResults(contextId, result.toolCalls, result.toolResults)
  await sendLlmResponse(reply, contextId, result)
  return result
}

export const processMessage = async (
  reply: ReplyFn,
  contextId: string,
  chatUserId: string,
  username: string | null,
  userText: string,
  contextType: 'dm' | 'group',
  configContextId?: string,
  deps: LlmOrchestratorDeps = defaultDeps,
): Promise<void> => {
  log.debug({ contextId, configContextId, chatUserId, userText }, 'processMessage called')
  log.info({ contextId, chatUserId, messageLength: userText.length }, 'Message received from user')

  const baseHistory = getCachedHistory(contextId)
  const newMessage: ModelMessage = { role: 'user', content: userText }
  const history = [...baseHistory, newMessage]
  appendHistory(contextId, [newMessage])
  try {
    const result = await callLlm(reply, contextId, chatUserId, username, history, contextType, deps, configContextId)
    const assistantMessages = result.response.messages
    if (assistantMessages.length > 0) {
      appendHistory(contextId, assistantMessages)
      log.debug(
        { contextId, assistantMessagesCount: assistantMessages.length },
        'Assistant response appended to history',
      )
    }
    if (shouldTriggerTrim([...history, ...assistantMessages])) {
      void runTrimInBackground(contextId, [...history, ...assistantMessages])
    }
  } catch (error) {
    // Use configContextId for config lookup if available, otherwise fall back to contextId
    const cfgId = configContextId ?? contextId
    emit('llm:error', {
      userId: contextId,
      error: error instanceof Error ? error.message : String(error),
      model: getConfig(cfgId, 'main_model') ?? 'unknown',
    })
    saveHistory(contextId, baseHistory)
    await handleOrchestratorMessageError(reply, contextId, error)
  }
}
