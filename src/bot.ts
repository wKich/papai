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
import { dispatchGroupSelectorResult } from './group-settings/dispatch.js'
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
  processMessage: (
    reply: ReplyFn,
    contextId: string,
    chatUserId: string,
    username: string | null,
    userText: string,
    contextType: 'dm' | 'group',
  ) => Promise<void>
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
  const orig = chat.registerCommand.bind(chat)
  const withObs =
    (
      h: (m: IncomingMessage, r: ReplyFn, a: AuthorizationResult) => Promise<void>,
    ): ((m: IncomingMessage, r: ReplyFn, a: AuthorizationResult) => Promise<void>) =>
    async (m, r, a) => {
      if (m.contextType === 'group' && a.isGroupAdmin) recordGroupObservation(chat, m)
      await h(m, r, a)
    }
  const w: ChatProvider = {
    ...chat,
    registerCommand: (name, handler): void => {
      orig(name, withObs(handler))
    },
  }
  registerHelpCommand(w)
  registerStartCommand(w)
  registerSetupCommand(w, checkAuthorization)
  registerConfigCommand(w, checkAuthorization)
  registerContextCommand(w)
  registerClearCommand(w, checkAuthorization, adminUserId)
  registerAdminCommands(w, adminUserId)
  registerGroupCommand(w)
}

function userNeedsSetup(storageContextId: string, taskProvider: 'kaneo' | 'youtrack'): boolean {
  const config = getAllConfig(storageContextId)
  return getWizardSteps(taskProvider).some((step) => {
    if (step.isOptional === true) return false
    const value = config[step.key]
    return value === undefined || value === ''
  })
}

async function autoStartWizardIfNeeded(userId: string, storageContextId: string, reply: ReplyFn): Promise<boolean> {
  if (hasActiveWizard(userId, storageContextId)) return false
  if (process.env['DEMO_MODE'] === 'true' && isDemoUser(userId)) return false
  const taskProvider = process.env['TASK_PROVIDER'] === 'youtrack' ? 'youtrack' : 'kaneo'
  if (!userNeedsSetup(storageContextId, taskProvider)) return false
  const result = createWizard(userId, storageContextId, taskProvider)
  if (result.success) await reply.text(result.prompt)
  return result.success
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
      coalescedItem.userId,
      coalescedItem.username,
      coalescedItem.text,
      coalescedItem.contextType,
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

  if (msg.contextType === 'group' && (msg.commandMatch === undefined || msg.commandMatch === '') && !msg.isMentioned)
    return

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
    if (await dispatchGroupSelectorResult(selection, reply, msg.user.id, interactiveButtons)) {
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
  if ((msg.commandMatch === undefined || msg.commandMatch === '') && !msg.isMentioned) return
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
