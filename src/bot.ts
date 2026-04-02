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
import { isGroupMember } from './groups.js'
import { processMessage } from './llm-orchestrator.js'
import { logger } from './logger.js'
import { buildPromptWithReplyContext } from './reply-context.js'
import { addUser, isAuthorized, isDemoUser, resolveUserByUsername } from './users.js'
import { createWizard, hasActiveWizard, processWizardMessage } from './wizard/index.js'
import { getWizardSteps } from './wizard/steps.js'

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

async function handleWizardMessage(
  userId: string,
  storageContextId: string,
  text: string,
  reply: ReplyFn,
  platform: string,
): Promise<boolean> {
  if (!hasActiveWizard(userId, storageContextId)) {
    return false
  }

  const wizardResult = await processWizardMessage(userId, storageContextId, text)

  if (wizardResult.handled) {
    // Only show buttons on Telegram (Mattermost buttons don't work due to missing webhook handler)
    const buttons = wizardResult.buttons
    const shouldShowButtons = platform === 'telegram' && buttons !== undefined && buttons.length > 0
    if (shouldShowButtons && buttons !== undefined) {
      // Send message with buttons
      const chatButtons: import('./chat/types.js').ChatButton[] = buttons.map((btn) => {
        let style: 'primary' | 'secondary' | 'danger' = 'primary'
        if (btn.action === 'cancel') {
          style = 'danger'
        } else if (btn.action === 'skip_small_model' || btn.action === 'skip_embedding') {
          style = 'secondary'
        }
        return {
          text: btn.text,
          callbackData: `wizard_${btn.action}`,
          style,
        }
      })
      await reply.buttons(wizardResult.response ?? '', { buttons: chatButtons })
    } else if (wizardResult.response !== undefined && wizardResult.response !== '') {
      await reply.text(wizardResult.response)
    }
    return true
  }

  return false
}

async function handleMessage(msg: IncomingMessage, reply: ReplyFn, auth: AuthorizationResult): Promise<void> {
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

  reply.typing()
  const prompt = buildPromptWithReplyContext(msg)
  await processMessage(reply, auth.storageContextId, msg.user.username, prompt)
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

  // Use auth.storageContextId (not msg.contextId) for wizard lookup
  // This ensures DM wizards use userId, group wizards use groupId
  if (!isCommand) {
    const wasWizardHandled = await handleWizardMessage(msg.user.id, auth.storageContextId, msg.text, reply, platform)
    if (wasWizardHandled) return true
  }

  return false
}

async function onIncomingMessage(chat: ChatProvider, msg: IncomingMessage, reply: ReplyFn): Promise<void> {
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
    await handleMessage(msg, reply, auth)
  } finally {
    emit('message:replied', {
      userId: msg.user.id,
      contextId: msg.contextId,
      duration: Date.now() - start,
    })
  }
}

export function setupBot(chat: ChatProvider, adminUserId: string): void {
  registerCommands(chat, adminUserId)
  chat.onMessage((msg, reply) => onIncomingMessage(chat, msg, reply))
}
