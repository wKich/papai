import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { APICallError } from '@ai-sdk/provider'
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai'

import { getCachedHistory, getCachedTools, setCachedTools } from './cache.js'
import type { ReplyFn } from './chat/types.js'
import { getConfig } from './config.js'
import { buildMessagesWithMemory, runTrimInBackground, shouldTriggerTrim } from './conversation.js'
import { emit } from './debug/event-bus.js'
import { getUserMessage, isAppError } from './errors.js'
import { appendHistory, saveHistory } from './history.js'
import { logger } from './logger.js'
import { extractFactsFromSdkResults, upsertFact } from './memory.js'
import { ProviderClassifiedError } from './providers/errors.js'
import { buildProviderForUser } from './providers/factory.js'
import { KaneoClassifiedError } from './providers/kaneo/classify-error.js'
import { maybeProvisionKaneo } from './providers/kaneo/provision.js'
import type { TaskProvider } from './providers/types.js'
import { YouTrackClassifiedError } from './providers/youtrack/classify-error.js'
import { buildSystemPrompt } from './system-prompt.js'
import { makeTools } from './tools/index.js'

const log = logger.child({ scope: 'llm-orchestrator' })

const buildOpenAI = (apiKey: string, baseURL: string): ReturnType<typeof createOpenAICompatible> =>
  createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL })
const TASK_PROVIDER = process.env['TASK_PROVIDER'] ?? 'kaneo'

const checkRequiredConfig = (contextId: string): string[] => {
  const llmKeys = ['llm_apikey', 'llm_baseurl', 'main_model'] as const
  const providerKeys = TASK_PROVIDER === 'youtrack' ? (['youtrack_token'] as const) : (['kaneo_apikey'] as const)
  return [...llmKeys, ...providerKeys].filter((k) => getConfig(contextId, k) === null)
}

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

const buildProvider = (contextId: string): TaskProvider => buildProviderForUser(contextId, true)
const isToolSet = (value: unknown): value is ToolSet =>
  typeof value === 'object' && value !== null && Object.keys(value).length > 0

const getOrCreateTools = (contextId: string, provider: TaskProvider): ToolSet => {
  const cachedTools = getCachedTools(contextId)
  if (cachedTools !== undefined && cachedTools !== null && isToolSet(cachedTools)) {
    log.debug({ contextId }, 'Using cached tools')
    return cachedTools
  }
  log.debug({ contextId }, 'Building tools (cache miss)')
  const tools = makeTools(provider, contextId)
  setCachedTools(contextId, tools)
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
  contextId: string,
  mainModel: string,
  model: ReturnType<ReturnType<typeof buildOpenAI>>,
  provider: TaskProvider,
  tools: ToolSet,
  timezone: string,
  messagesWithMemory: ModelMessage[],
): Promise<Awaited<ReturnType<typeof generateText>>> => {
  const start = Date.now()
  emit('llm:start', {
    userId: contextId,
    model: mainModel,
    messageCount: messagesWithMemory.length,
    toolCount: Object.keys(tools).length,
  })
  const result = await generateText({
    model,
    system: buildSystemPrompt(provider, timezone, contextId),
    messages: messagesWithMemory,
    tools,
    stopWhen: stepCountIs(25),
    experimental_onToolCallStart(event) {
      emit('llm:tool_call', {
        userId: contextId,
        toolName: event.toolCall.toolName,
        toolCallId: event.toolCall.toolCallId,
        args: event.toolCall.input,
      })
    },
    experimental_onToolCallFinish(event) {
      emit('llm:tool_result', {
        userId: contextId,
        toolName: event.toolCall.toolName,
        toolCallId: event.toolCall.toolCallId,
        durationMs: event.durationMs,
        success: event.success,
        ...(event.success ? {} : { error: String(event.error) }),
      })
    },
  })
  emit('llm:end', {
    userId: contextId,
    model: mainModel,
    steps: result.steps.length,
    totalDuration: Date.now() - start,
    tokenUsage: result.usage,
  })
  return result
}

const callLlm = async (
  reply: ReplyFn,
  contextId: string,
  username: string | null,
  history: readonly ModelMessage[],
): Promise<{ response: { messages: ModelMessage[] } }> => {
  await maybeProvisionKaneo(reply, contextId, username)
  const missing = checkRequiredConfig(contextId)
  if (missing.length > 0) {
    log.warn({ contextId, missing }, 'Missing required config keys')
    await reply.text(`Missing configuration: ${missing.join(', ')}.\nUse /setup to configure.`)
    throw new Error('Missing configuration')
  }
  const llmApiKey = getConfig(contextId, 'llm_apikey')!
  const llmBaseUrl = getConfig(contextId, 'llm_baseurl')!
  const mainModel = getConfig(contextId, 'main_model')!
  const model = buildOpenAI(llmApiKey, llmBaseUrl)(mainModel)
  const provider = buildProvider(contextId)
  const tools = getOrCreateTools(contextId, provider)
  const timezone = getConfig(contextId, 'timezone') ?? 'UTC'
  const { messages: messagesWithMemory, memoryMsg } = buildMessagesWithMemory(contextId, history)
  log.debug(
    { contextId, historyLength: history.length, hasMemory: memoryMsg !== null, timezone },
    'Calling generateText',
  )
  const result = await invokeModel(contextId, mainModel, model, provider, tools, timezone, messagesWithMemory)
  log.debug({ contextId, toolCalls: result.toolCalls?.length, usage: result.usage }, 'LLM response received')
  persistFactsFromResults(contextId, result.toolCalls, result.toolResults)
  await sendLlmResponse(reply, contextId, result)
  return result
}

const extractErrorDetails = (error: unknown): Record<string, unknown> => {
  if (APICallError.isInstance(error)) {
    return {
      type: 'APICallError',
      message: error.message,
      statusCode: error.statusCode,
      url: error.url,
      responseBody: error.responseBody,
      responseHeaders: error.responseHeaders,
      isRetryable: error.isRetryable,
      data: error.data,
    }
  }
  if (isAppError(error)) {
    return { type: 'AppError', errorType: error.type, code: error.code }
  }
  if (error instanceof Error) {
    return { type: error.name, message: error.message }
  }
  return { type: 'unknown', value: String(error) }
}

const handleMessageError = async (reply: ReplyFn, contextId: string, error: unknown): Promise<void> => {
  const errDetails = extractErrorDetails(error)
  log.error({ contextId, error: errDetails }, 'Message handling failed')
  if (isAppError(error)) await reply.text(getUserMessage(error))
  else if (error instanceof KaneoClassifiedError || error instanceof YouTrackClassifiedError)
    await reply.text(getUserMessage(error.appError))
  else if (error instanceof ProviderClassifiedError) await reply.text(getUserMessage(error.error))
  else
    await reply.text(
      APICallError.isInstance(error)
        ? 'API call failed. Please try again.'
        : 'An unexpected error occurred. Please try again later.',
    )
}

export const processMessage = async (
  reply: ReplyFn,
  contextId: string,
  username: string | null,
  userText: string,
): Promise<void> => {
  log.debug({ contextId, userText }, 'processMessage called')
  log.info({ contextId, messageLength: userText.length }, 'Message received from user')

  const baseHistory = getCachedHistory(contextId)
  const newMessage: ModelMessage = { role: 'user', content: userText }
  const history = [...baseHistory, newMessage]
  appendHistory(contextId, [newMessage])
  try {
    const result = await callLlm(reply, contextId, username, history)
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
    emit('llm:error', {
      userId: contextId,
      error: error instanceof Error ? error.message : String(error),
      model: getConfig(contextId, 'main_model') ?? 'unknown',
    })
    saveHistory(contextId, baseHistory)
    await handleMessageError(reply, contextId, error)
  }
}
