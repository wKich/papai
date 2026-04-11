import { checkAuthorizationExtended, getThreadScopedStorageContextId } from './auth.js'
import { supportsInteractiveButtons } from './chat/capabilities.js'
import { handleConfigEditorMessage } from './chat/config-editor-integration.js'
import { routeInteraction } from './chat/interaction-router.js'
import type { AuthorizationResult, ChatProvider, IncomingFile, IncomingMessage, ReplyFn } from './chat/types.js'
import { renderConfigForTarget } from './commands/config.js'
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
import { upsertGroupAdminObservation, upsertKnownGroupContext } from './group-settings/registry.js'
import { handleGroupSettingsSelectorMessage } from './group-settings/selector.js'
import { getActiveGroupSettingsTarget } from './group-settings/state.js'
import { processMessage as defaultProcessMessage } from './llm-orchestrator.js'
import { logger } from './logger.js'
import { enqueueMessage } from './message-queue/index.js'
import { buildPromptWithReplyContext } from './reply-context.js'
import { isAuthorized, isDemoUser, resolveUserByUsername } from './users.js'
import { handleWizardMessage } from './wizard-integration.js'
import { createWizard, hasActiveWizard } from './wizard/index.js'
import { getWizardSteps } from './wizard/steps.js'

export interface BotDeps {
  processMessage: (reply: ReplyFn, contextId: string, username: string | null, userText: string) => Promise<void>
}

const defaultBotDeps: BotDeps = { processMessage: defaultProcessMessage }

const log = logger.child({ scope: 'bot' })

const checkAuthorization = (userId: string, username?: string | null): boolean => {
  log.debug({ userId }, 'Checking authorization')
  if (isAuthorized(userId)) return true
  if (username !== undefined && username !== null && resolveUserByUsername(userId, username)) return true
  log.warn({ attemptedUserId: userId }, 'Unauthorized access attempt')
  return false
}

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

  return steps.some((step) => {
    if (step.isOptional === true) return false
    const value = config[step.key]
    return value === undefined || value === ''
  })
}

async function autoStartWizardIfNeeded(userId: string, storageContextId: string, reply: ReplyFn): Promise<boolean> {
  if (hasActiveWizard(userId, storageContextId)) return false

  if (process.env['DEMO_MODE'] === 'true' && isDemoUser(userId)) return false

  const taskProvider = process.env['TASK_PROVIDER'] === 'youtrack' ? 'youtrack' : 'kaneo'

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
    files: readonly IncomingFile[]
    reply: ReplyFn
  },
  deps: BotDeps,
): Promise<void> {
  const start = Date.now()

  coalescedItem.reply.typing()

  if (coalescedItem.files.length > 0) {
    storeIncomingFiles(coalescedItem.storageContextId, coalescedItem.files)
  } else {
    clearIncomingFiles(coalescedItem.storageContextId)
  }

  try {
    await deps.processMessage(
      coalescedItem.reply,
      coalescedItem.storageContextId,
      coalescedItem.username,
      coalescedItem.text,
    )
  } finally {
    clearIncomingFiles(coalescedItem.storageContextId)
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
    return
  }

  const queueItem = {
    text: buildPromptWithReplyContext(msg),
    userId: msg.user.id,
    username: msg.user.username,
    storageContextId: auth.storageContextId,
    contextType: msg.contextType,
    files: msg.files ?? [],
  }

  enqueueMessage(queueItem, reply, (coalescedItem) => processCoalescedMessage(coalescedItem, deps))
}

async function maybeInterceptWizard(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  interactiveButtons: boolean,
): Promise<boolean> {
  const isCommand = msg.text.startsWith('/')

  if (!isCommand && msg.contextType === 'dm') {
    const selection = handleGroupSettingsSelectorMessage(msg.user.id, msg.text, interactiveButtons)
    if (selection.handled) {
      if ('continueWith' in selection) {
        if (selection.continueWith.command !== 'config') return false
        await renderConfigForTarget(reply, selection.continueWith.targetContextId, interactiveButtons)
      } else if ('buttons' in selection && selection.buttons !== undefined) {
        await reply.buttons(selection.response, { buttons: selection.buttons })
      } else if ('response' in selection) {
        await reply.text(selection.response)
      }
      return true
    }
  }

  const settingsTargetContextId =
    msg.contextType === 'dm'
      ? (getActiveGroupSettingsTarget(msg.user.id) ?? auth.storageContextId)
      : auth.storageContextId

  if (
    !isCommand &&
    auth.allowed &&
    (await handleConfigEditorMessage(msg.user.id, settingsTargetContextId, msg.text, reply))
  )
    return true

  if (
    !isCommand &&
    (await handleWizardMessage(msg.user.id, settingsTargetContextId, msg.text, reply, interactiveButtons))
  )
    return true

  if (!isCommand && auth.allowed && (await autoStartWizardIfNeeded(msg.user.id, auth.storageContextId, reply)))
    return true

  return false
}

function recordGroupObservation(chat: ChatProvider, msg: IncomingMessage): void {
  if (msg.contextType !== 'group') return

  upsertKnownGroupContext({
    contextId: msg.contextId,
    provider: chat.name,
    displayName: msg.contextName ?? msg.contextId,
    parentName: msg.contextParentName ?? null,
  })
  upsertGroupAdminObservation({
    contextId: msg.contextId,
    userId: msg.user.id,
    username: msg.user.username,
    isAdmin: msg.user.isAdmin,
  })
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

  recordGroupObservation(chat, msg)

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
      await routeInteraction(interaction, reply)
    } catch (error) {
      logger.error(
        {
          callbackData: interaction.callbackData,
          userId: interaction.user?.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'Interaction routing failed',
      )
    }
  })
}
