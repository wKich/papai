import { checkAuthorizationExtended, getThreadScopedStorageContextId } from './auth.js'
import { supportsInteractiveButtons } from './chat/capabilities.js'
import { handleConfigEditorMessage } from './chat/config-editor-integration.js'
import { routeInteraction } from './chat/interaction-router.js'
import type { AuthorizationResult, ChatProvider, IncomingFile, IncomingMessage, ReplyFn } from './chat/types.js'
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
import { enqueueMessage } from './message-queue/index.js'
import { buildPromptWithReplyContext } from './reply-context.js'
import { isAuthorized, isDemoUser, resolveUserByUsername } from './users.js'
import { handleWizardMessage } from './wizard-integration.js'
import { createWizard, hasActiveWizard } from './wizard/index.js'
import { getWizardSteps } from './wizard/steps.js'

export interface BotDeps {
  processMessage: (
    reply: ReplyFn,
    contextId: string,
    chatUserId: string,
    username: string | null,
    userText: string,
    contextType: 'dm' | 'group',
  ) => Promise<void>
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

async function processCoalescedMessage(
  coalescedItem: {
    text: string
    userId: string
    username: string | null
    storageContextId: string
    contextType: 'dm' | 'group'
    files: readonly IncomingFile[]
    reply: ReplyFn
  },
  deps: BotDeps,
): Promise<void> {
  const start = Date.now()

  // Show typing when processing starts
  coalescedItem.reply.typing()

  // Store accumulated files before processing
  if (coalescedItem.files.length > 0) {
    storeIncomingFiles(coalescedItem.storageContextId, coalescedItem.files)
  } else {
    clearIncomingFiles(coalescedItem.storageContextId)
  }

  try {
    await deps.processMessage(
      coalescedItem.reply,
      coalescedItem.storageContextId,
      coalescedItem.userId,
      coalescedItem.username,
      coalescedItem.text,
      coalescedItem.contextType,
    )
  } finally {
    // Clear files after processing
    clearIncomingFiles(coalescedItem.storageContextId)

    // Emit metrics (moved from caller to handler callback)
    emit('message:replied', {
      userId: coalescedItem.userId,
      contextId: coalescedItem.storageContextId,
      duration: Date.now() - start,
    })
  }
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

  // Create queue item
  const queueItem = {
    text: buildPromptWithReplyContext(msg),
    userId: msg.user.id,
    username: msg.user.username,
    storageContextId: auth.storageContextId,
    contextType: msg.contextType,
    files: msg.files ?? [],
  }

  // Enqueue the message (fire-and-forget)
  enqueueMessage(queueItem, reply, (coalescedItem) => processCoalescedMessage(coalescedItem, deps))
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
    try {
      const auth = checkAuthorizationExtended(
        interaction.user.id,
        interaction.user.username,
        interaction.contextId,
        interaction.contextType,
        interaction.threadId,
        interaction.user.isAdmin,
      )
      await routeInteraction(interaction, reply, auth)
    } catch (error) {
      logger.error(
        {
          callbackData: interaction.callbackData,
          userId: interaction.user.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'Interaction routing failed',
      )
      await reply.text('❌ Something went wrong processing your action. Please try again.')
    }
  })
}
