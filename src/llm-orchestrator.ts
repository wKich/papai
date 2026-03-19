import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { APICallError } from '@ai-sdk/provider'
import { generateText, stepCountIs, type ToolSet } from 'ai'
import { type ModelMessage } from 'ai'

import { getCachedHistory, getCachedTools, setCachedTools } from './cache.js'
import type { ReplyFn } from './chat/types.js'
import { getConfig } from './config.js'
import { buildMessagesWithMemory, runTrimInBackground, shouldTriggerTrim } from './conversation.js'
import { getUserMessage, isAppError } from './errors.js'
import { appendHistory, saveHistory } from './history.js'
import { logger } from './logger.js'
import { extractFactsFromSdkResults, upsertFact } from './memory.js'
import { provisionAndConfigure } from './providers/kaneo/provision.js'
import { createProvider } from './providers/registry.js'
import type { TaskProvider } from './providers/types.js'
import { makeTools } from './tools/index.js'
import { getKaneoWorkspace } from './users.js'

const log = logger.child({ scope: 'llm-orchestrator' })

const BASE_SYSTEM_PROMPT = `You are papai, a personal assistant that helps the user manage their tasks.
Current date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

When the user asks you to do something, figure out which tool(s) to call and execute them autonomously — fetch any missing context (projects, columns, task details) with additional tool calls before acting, without asking the user.

WORKFLOW:
1. Understand the user's intent from natural language.
2. Gather context if needed (e.g. call list_projects to resolve a project name, call list_columns before setting a task status).
3. Call the appropriate tool(s) to fulfil the request.
4. Reply with a concise confirmation.

AMBIGUITY — When the user's phrasing implies a single target (uses "the task", "it", "that one", or a specific title) but the search returns multiple equally-likely candidates, ask ONE short question to disambiguate before acting. When the phrasing implies multiple targets ("all", "every", "these", plural nouns), operate on all matches without asking. For referential phrases ("move it", "close that"), resolve from conversation context first; only ask if truly unresolvable.

DESTRUCTIVE ACTIONS — archive_task, archive_project, delete_column, remove_label:
These tools require a confidence field (0–1) reflecting how explicitly the user requested the action.
- Set 1.0 when the user has already confirmed (e.g. replied "yes").
- Set 0.9 for a direct, unambiguous command ("archive the Auth project").
- Set ≤0.7 when the intent is indirect or inferred.
If the tool returns { status: "confirmation_required", message: "..." }, send the message to the user as a natural question and wait for their reply before retrying the tool call with confidence 1.0.

RELATION TYPES — map user language to the correct type when calling add_task_relation / update_task_relation:
- "depends on" / "blocked by" / "waiting on" → blocked_by
- "blocks" / "is blocking" → blocks
- "duplicate of" / "same as" / "copy of" / "identical to" → duplicate
- "child of" / "subtask of" / "part of" → parent
- "related to" / "linked to" / anything else → related

OUTPUT RULES:
- When referencing tasks or projects, format them as Markdown links: [Task title](url). Never output raw IDs.
- Keep replies short and friendly.
- Don't use tables.`

const buildSystemPrompt = (provider: TaskProvider): string => {
  const addendum = provider.getPromptAddendum()
  if (addendum === '') return BASE_SYSTEM_PROMPT
  return `${BASE_SYSTEM_PROMPT}\n\n${addendum}`
}

const buildOpenAI = (apiKey: string, baseURL: string): ReturnType<typeof createOpenAICompatible> =>
  createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL })

const checkRequiredConfig = (userId: string): string[] => {
  const llmKeys = ['llm_apikey', 'llm_baseurl', 'main_model'] as const
  const providerName = getConfig(userId, 'provider') ?? 'kaneo'
  const providerKeys =
    providerName === 'youtrack' ? (['youtrack_url', 'youtrack_token'] as const) : (['kaneo_apikey'] as const)
  return [...llmKeys, ...providerKeys].filter((k) => getConfig(userId, k) === null)
}

const persistFactsFromResults = (
  userId: string,
  toolCalls: Array<{ toolName: string; input: unknown }>,
  toolResults: Array<{ toolName: string; output: unknown }>,
): void => {
  const newFacts = extractFactsFromSdkResults(toolCalls, toolResults)
  if (newFacts.length === 0) return
  for (const fact of newFacts) upsertFact(userId, fact)
  log.info({ userId, factsExtracted: newFacts.length, factsUpserted: newFacts.length }, 'Facts extracted and persisted')
}

const maybeProvisionKaneo = async (reply: ReplyFn, userId: string, username: string | null): Promise<void> => {
  if (getKaneoWorkspace(userId) !== null && getConfig(userId, 'kaneo_apikey') !== null) return
  const outcome = await provisionAndConfigure(userId, username)
  if (outcome.status === 'provisioned') {
    await reply.text(
      `✅ Your Kaneo account has been created!\n🌐 ${outcome.kaneoUrl}\n📧 Email: ${outcome.email}\n🔑 Password: ${outcome.password}\n\nThe bot is already configured and ready to use.`,
    )
  } else if (outcome.status === 'registration_disabled') {
    await reply.text(
      'Kaneo account could not be created — registration is currently disabled on this instance.\n\nPlease ask the admin to provision your account.',
    )
  }
}

const buildProvider = (userId: string): TaskProvider => {
  const providerName = getConfig(userId, 'provider') ?? 'kaneo'
  log.debug({ userId, providerName }, 'Building provider')

  if (providerName === 'kaneo') {
    const kaneoKey = getConfig(userId, 'kaneo_apikey')!
    const kaneoBaseUrl = process.env['KANEO_CLIENT_URL']!
    const workspaceId = getKaneoWorkspace(userId)!
    const isSessionCookie = kaneoKey.startsWith('better-auth.session_token=')
    const config: Record<string, string> = isSessionCookie
      ? { baseUrl: kaneoBaseUrl, sessionCookie: kaneoKey, workspaceId }
      : { apiKey: kaneoKey, baseUrl: kaneoBaseUrl, workspaceId }
    return createProvider('kaneo', config)
  }

  if (providerName === 'youtrack') {
    const baseUrl = getConfig(userId, 'youtrack_url')!
    const token = getConfig(userId, 'youtrack_token')!
    return createProvider('youtrack', { baseUrl, token })
  }

  return createProvider(providerName, {})
}

const isToolSet = (value: unknown): value is ToolSet =>
  typeof value === 'object' && value !== null && Object.keys(value).length > 0

const getOrCreateTools = (userId: string, provider: TaskProvider): ToolSet => {
  const cachedTools = getCachedTools(userId)
  if (cachedTools !== undefined && cachedTools !== null && isToolSet(cachedTools)) {
    log.debug({ userId }, 'Using cached tools')
    return cachedTools
  }
  log.debug({ userId }, 'Building tools (cache miss)')
  const tools = makeTools(provider)
  setCachedTools(userId, tools)
  return tools
}

const sendLlmResponse = async (
  reply: ReplyFn,
  userId: string,
  result: { text?: string; toolCalls?: unknown[]; response: { messages: ModelMessage[] } },
): Promise<void> => {
  const assistantText = result.text
  const textToFormat = assistantText !== undefined && assistantText !== '' ? assistantText : 'Done.'
  await reply.formatted(textToFormat)
  log.info(
    { userId, responseLength: assistantText?.length ?? 0, toolCalls: result.toolCalls?.length ?? 0 },
    'Response sent successfully',
  )
}

const callLlm = async (
  reply: ReplyFn,
  userId: string,
  username: string | null,
  history: readonly ModelMessage[],
): Promise<{ response: { messages: ModelMessage[] } }> => {
  await maybeProvisionKaneo(reply, userId, username)
  const missing = checkRequiredConfig(userId)
  if (missing.length > 0) {
    log.warn({ userId, missing }, 'Missing required config keys')
    await reply.text(`Missing configuration: ${missing.join(', ')}.\nUse /set <key> <value> to configure.`)
    throw new Error('Missing configuration')
  }
  const llmApiKey = getConfig(userId, 'llm_apikey')!
  const llmBaseUrl = getConfig(userId, 'llm_baseurl')!
  const mainModel = getConfig(userId, 'main_model')!
  const model = buildOpenAI(llmApiKey, llmBaseUrl)(mainModel)
  const provider = buildProvider(userId)
  const tools = getOrCreateTools(userId, provider)
  const { messages: messagesWithMemory, memoryMsg } = buildMessagesWithMemory(userId, history)
  log.debug({ userId, historyLength: history.length, hasMemory: memoryMsg !== null }, 'Calling generateText')
  const result = await generateText({
    model,
    system: buildSystemPrompt(provider),
    messages: messagesWithMemory,
    tools,
    stopWhen: stepCountIs(25),
  })
  log.debug({ userId, toolCalls: result.toolCalls?.length, usage: result.usage }, 'LLM response received')
  persistFactsFromResults(userId, result.toolCalls, result.toolResults)
  await sendLlmResponse(reply, userId, result)
  return result
}

const handleMessageError = async (reply: ReplyFn, _userId: string, error: unknown): Promise<void> => {
  if (isAppError(error)) {
    await reply.text(getUserMessage(error))
  } else if (APICallError.isInstance(error)) {
    await reply.text('An unexpected error occurred. Please try again later.')
  } else {
    await reply.text('An unexpected error occurred. Please try again later.')
  }
}

export const processMessage = async (
  reply: ReplyFn,
  userId: string,
  username: string | null,
  userText: string,
): Promise<void> => {
  log.debug({ userId, userText }, 'processMessage called')
  log.info({ userId, messageLength: userText.length }, 'Message received from user')

  const baseHistory = getCachedHistory(userId)
  const newMessage: ModelMessage = { role: 'user', content: userText }
  const history = [...baseHistory, newMessage]

  appendHistory(userId, [newMessage])

  try {
    const result = await callLlm(reply, userId, username, history)

    // result.response.messages contains ONLY the newly generated messages (assistant + tool
    // messages from all steps). The Vercel AI SDK does NOT include input messages there —
    // it starts an empty array and pushes generated messages as steps complete.
    // So we append all of them directly, no slicing needed.
    const assistantMessages = result.response.messages
    if (assistantMessages.length > 0) {
      appendHistory(userId, assistantMessages)
      log.debug({ userId, assistantMessagesCount: assistantMessages.length }, 'Assistant response appended to history')
    }

    // Trigger trim only after successful response
    const needsTrim = shouldTriggerTrim([...history, ...assistantMessages])
    if (needsTrim) {
      void runTrimInBackground(userId, [...history, ...assistantMessages])
    }
  } catch (error) {
    saveHistory(userId, baseHistory)
    await handleMessageError(reply, userId, error)
  }
}
