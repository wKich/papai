import { checkAuthorizationExtended, getThreadScopedStorageContextId } from './auth.js'
import { supportsInteractiveButtons } from './chat/capabilities.js'
import { handleConfigEditorMessage } from './chat/config-editor-integration.js'
import { routeInteraction } from './chat/interaction-router.js'
import type { AuthorizationResult, ChatProvider, IncomingMessage, ReplyFn } from './chat/types.js'
import {
  registerAdminCommands,
  registerClearCommand,
  registerConfigCommand,
  registerContextCommand,
  registerGroupCommand,
  registerHelpCommand,
  registerSetupCommand,
  registerStartCommand,
} from './commands/index.js'
import { getAllConfig } from './config.js'
import { emit } from './debug/event-bus.js'
import { clearIncomingFiles, storeIncomingFiles } from './file-relay.js'
import { processMessage as defaultProcessMessage } from './llm-orchestrator.js'
import { logger } from './logger.js'
import { buildPromptWithReplyContext } from './reply-context.js'
import { isAuthorized, isDemoUser, resolveUserByUsername } from './users.js'
import { handleWizardMessage } from './wizard-integration.js'
import { createWizard, hasActiveWizard } from './wizard/index.js'
import { getWizardSteps } from './wizard/steps.js'

export interface BotDeps {
  processMessage: (reply: ReplyFn, contextId: string, username: string | null, userText: string) => Promise<void>
}

const defaultBotDeps: BotDeps = {
  processMessage: defaultProcessMessage,
}

const log = logger.child({ scope: 'bot' })

const checkAuthorization = (userId: string, username?: string | null): boolean => {
  log.debug({ userId }, 'Checking authorization')
  if (isAuthorized(userId)) return true
  if (username !== undefined && username !== null && resolveUserByUsername(userId, username)) return true
  log.warn({ attemptedUserId: userId }, 'Unauthorized access attempt')
  return false
}

// Re-export for backward compatibility
export { checkAuthorizationExtended, getThreadScopedStorageContextId }

function registerCommands(chat: ChatProvider, adminUserId: string): void {
  registerHelpCommand(chat)
  registerStartCommand(chat)
  registerSetupCommand(chat, checkAuthorization)
  registerConfigCommand(chat, checkAuthorization)
  registerContextCommand(chat, adminUserId)
  registerClearCommand(chat, checkAuthorization, adminUserId)
  registerAdminCommands(chat, adminUserId)
  registerGroupCommand(chat)
}

function userNeedsSetup(storageContextId: string, taskProvider: 'kaneo' | 'youtrack'): boolean {
  const config = getAllConfig(storageContextId)
  const steps = getWizardSteps(taskProvider)

  // Check if any required step is missing a value
  return steps.some((step) => {
    if (step.isOptional === true) return false
    const value = config[step.key]
    return value === undefined || value === ''
  })
}

async function autoStartWizardIfNeeded(userId: string, storageContextId: string, reply: ReplyFn): Promise<boolean> {
  if (hasActiveWizard(userId, storageContextId)) return false

  // Demo users get config from admin via maybeProvisionKaneo — skip wizard
  if (process.env['DEMO_MODE'] === 'true' && isDemoUser(userId)) return false

  const taskProvider = process.env['TASK_PROVIDER'] === 'youtrack' ? 'youtrack' : 'kaneo'

  // Don't auto-start if user already has config
  if (!userNeedsSetup(storageContextId, taskProvider)) {
    return false
  }

  const result = createWizard(userId, storageContextId, taskProvider)

  if (result.success) {
    await reply.text(result.prompt)
    return true
  }

  return false
}

async function handleMessage(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  deps: BotDeps,
): Promise<void> {
  // Check authorization
  if (!auth.allowed) {
    if (msg.isMentioned) {
      await reply.text(
        "You're not authorized to use this bot in this group. Ask a group admin to add you with `/group adduser @{username}`",
      )
    }
    return
  }

  const hasCommand = msg.commandMatch !== undefined && msg.commandMatch !== ''
  const isNaturalLanguage = !hasCommand
  if (msg.contextType === 'group' && isNaturalLanguage && !msg.isMentioned) {
    // Silent ignore - natural language in groups requires mention
    return
  }

  // Relay incoming files to the file store so tools can access them this turn
  if (msg.files !== undefined && msg.files.length > 0) {
    storeIncomingFiles(auth.storageContextId, msg.files)
  } else {
    clearIncomingFiles(auth.storageContextId)
  }

  reply.typing()
  const prompt = buildPromptWithReplyContext(msg)
  await deps.processMessage(reply, auth.storageContextId, msg.user.username, prompt)
}

async function maybeInterceptWizard(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  interactiveButtons: boolean,
): Promise<boolean> {
  const isCommand = msg.text.startsWith('/')

  // AUTO-START WIZARD FOR NEW USERS
  // Only auto-start for authorized users (to maintain silent drop for unauthorized)
  if (!isCommand && auth.allowed) {
    const wasWizardAutoStarted = await autoStartWizardIfNeeded(msg.user.id, auth.storageContextId, reply)
    if (wasWizardAutoStarted) return true
  }

  // CONFIG EDITOR INTERCEPTION - Check before wizard
  // If user is editing a config field via button UI, handle their input
  if (!isCommand) {
    const wasEditorHandled = await handleConfigEditorMessage(msg.user.id, auth.storageContextId, msg.text, reply)
    if (wasEditorHandled) return true
  }

  // Use auth.storageContextId (not msg.contextId) for wizard lookup
  // This ensures DM wizards use userId, group wizards use groupId
  if (!isCommand) {
    const wasWizardHandled = await handleWizardMessage(
      msg.user.id,
      auth.storageContextId,
      msg.text,
      reply,
      interactiveButtons,
    )
    if (wasWizardHandled) return true
  }

  return false
}

async function onIncomingMessage(
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  deps: BotDeps,
): Promise<void> {
  emit('message:received', {
    userId: msg.user.id,
    contextId: msg.contextId,
    contextType: msg.contextType,
    threadId: msg.threadId,
    textLength: msg.text.length,
    isCommand: msg.text.startsWith('/'),
  })

  // Get authorization FIRST (needed for wizard storage context)
  const auth = checkAuthorizationExtended(
    msg.user.id,
    msg.user.username,
    msg.contextId,
    msg.contextType,
    msg.threadId,
    msg.user.isAdmin,
  )

  emit('auth:check', {
    userId: msg.user.id,
    allowed: auth.allowed,
    isBotAdmin: auth.isBotAdmin,
    isGroupAdmin: auth.isGroupAdmin,
    storageContextId: auth.storageContextId,
  })

  const interactiveButtons = supportsInteractiveButtons(chat)

  // WIZARD INTERCEPTION - Platform agnostic
  // Commands (starting with /) are always routed to their handlers, even during wizard
  if (await maybeInterceptWizard(msg, reply, auth, interactiveButtons)) return

  const start = Date.now()
  try {
    await handleMessage(msg, reply, auth, deps)
  } finally {
    emit('message:replied', {
      userId: msg.user.id,
      contextId: msg.contextId,
      duration: Date.now() - start,
    })
  }
}

export function setupBot(chat: ChatProvider, adminUserId: string, deps: BotDeps = defaultBotDeps): void {
  registerCommands(chat, adminUserId)
  chat.onMessage((msg, reply) => onIncomingMessage(chat, msg, reply, deps))
  chat.onInteraction?.(async (interaction, reply) => {
    await routeInteraction(interaction, reply)
  })
}
