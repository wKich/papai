import { handleConfigEditorMessage } from './chat/config-editor-integration.js'
import type { AuthorizationResult, ChatProvider, ContextType, IncomingMessage, ReplyFn } from './chat/types.js'
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
import { isGroupMember } from './groups.js'
import { processMessage as defaultProcessMessage } from './llm-orchestrator.js'
import { logger } from './logger.js'
import { buildPromptWithReplyContext } from './reply-context.js'
import { addUser, isAuthorized, isDemoUser, resolveUserByUsername } from './users.js'
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

const getBotAdminAuth = (
  userId: string,
  contextId: string,
  contextType: ContextType,
  isPlatformAdmin: boolean,
): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: true,
  isGroupAdmin: isPlatformAdmin,
  storageContextId: contextType === 'dm' ? userId : contextId,
})

const getGroupMemberAuth = (contextId: string, isPlatformAdmin: boolean): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: false,
  isGroupAdmin: isPlatformAdmin,
  storageContextId: contextId,
})

const getUnauthorizedGroupAuth = (contextId: string): AuthorizationResult => ({
  allowed: false,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: contextId,
})

const getDmUserAuth = (userId: string): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: true,
  isGroupAdmin: false,
  storageContextId: userId,
})

const getUnauthorizedDmAuth = (userId: string): AuthorizationResult => ({
  allowed: false,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: userId,
})

export const checkAuthorizationExtended = (
  userId: string,
  username: string | null,
  contextId: string,
  contextType: ContextType,
  isPlatformAdmin: boolean,
): AuthorizationResult => {
  log.debug({ userId, contextId, contextType }, 'Checking authorization')

  if (process.env['DEMO_MODE'] === 'true' && !isAuthorized(userId) && contextType === 'dm') {
    log.info({ userId, username }, 'Demo mode: auto-adding user')
    addUser(userId, 'demo-auto', username ?? undefined)
    return getGroupMemberAuth(userId, false)
  }

  if (isAuthorized(userId)) {
    if (contextType === 'dm' && isDemoUser(userId)) {
      return getGroupMemberAuth(userId, false)
    }
    return getBotAdminAuth(userId, contextId, contextType, isPlatformAdmin)
  }

  if (contextType === 'group') {
    if (isGroupMember(contextId, userId)) {
      return getGroupMemberAuth(contextId, isPlatformAdmin)
    }
    return getUnauthorizedGroupAuth(contextId)
  }

  if (username !== null && resolveUserByUsername(userId, username)) {
    return getDmUserAuth(userId)
  }

  return getUnauthorizedDmAuth(userId)
}

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

async function autoStartWizardIfNeeded(
  userId: string,
  storageContextId: string,
  platform: 'telegram' | 'mattermost',
  reply: ReplyFn,
): Promise<boolean> {
  if (hasActiveWizard(userId, storageContextId)) return false

  // Demo users get config from admin via maybeProvisionKaneo — skip wizard
  if (process.env['DEMO_MODE'] === 'true' && isDemoUser(userId)) return false

  const taskProvider = process.env['TASK_PROVIDER'] === 'youtrack' ? 'youtrack' : 'kaneo'

  // Don't auto-start if user already has config
  if (!userNeedsSetup(storageContextId, taskProvider)) {
    return false
  }

  const result = createWizard(userId, storageContextId, platform, taskProvider)

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
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
): Promise<boolean> {
  const isCommand = msg.text.startsWith('/')
  const platform = chat.name === 'telegram' || chat.name === 'mattermost' ? chat.name : 'telegram'

  // AUTO-START WIZARD FOR NEW USERS
  // Only auto-start for authorized users (to maintain silent drop for unauthorized)
  if (!isCommand && auth.allowed) {
    const wasWizardAutoStarted = await autoStartWizardIfNeeded(msg.user.id, auth.storageContextId, platform, reply)
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
    const wasWizardHandled = await handleWizardMessage(msg.user.id, auth.storageContextId, msg.text, reply, platform)
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
    textLength: msg.text.length,
    isCommand: msg.text.startsWith('/'),
  })

  // Get authorization FIRST (needed for wizard storage context)
  const auth = checkAuthorizationExtended(
    msg.user.id,
    msg.user.username,
    msg.contextId,
    msg.contextType,
    msg.user.isAdmin,
  )

  emit('auth:check', {
    userId: msg.user.id,
    allowed: auth.allowed,
    isBotAdmin: auth.isBotAdmin,
    isGroupAdmin: auth.isGroupAdmin,
    storageContextId: auth.storageContextId,
  })

  // WIZARD INTERCEPTION - Platform agnostic
  // Commands (starting with /) are always routed to their handlers, even during wizard
  if (await maybeInterceptWizard(chat, msg, reply, auth)) return

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
}
