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
import { isGroupMember } from './groups.js'
import { processMessage } from './llm-orchestrator.js'
import { logger } from './logger.js'
import { buildPromptWithReplyContext } from './reply-context.js'
import { CONFIG_KEYS } from './types/config.js'
import { isAuthorized, resolveUserByUsername } from './users.js'
import { createWizard, hasActiveWizard, processWizardMessage } from './wizard/index.js'

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

  if (isAuthorized(userId)) {
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

function userNeedsSetup(storageContextId: string): boolean {
  const config = getAllConfig(storageContextId)

  // Check if any required config keys are set
  // Consider user needs setup if they have fewer than 3 config values
  const configuredCount = CONFIG_KEYS.filter((key) => config[key] !== undefined).length
  return configuredCount < 3
}

async function autoStartWizardIfNeeded(
  userId: string,
  storageContextId: string,
  platform: 'telegram' | 'mattermost',
  reply: ReplyFn,
): Promise<boolean> {
  // Don't auto-start if wizard is already active
  if (hasActiveWizard(userId, storageContextId)) {
    return false
  }

  // Don't auto-start if user already has config
  if (!userNeedsSetup(storageContextId)) {
    return false
  }

  // Auto-start the wizard
  const taskProvider = process.env['TASK_PROVIDER'] === 'youtrack' ? 'youtrack' : 'kaneo'
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
): Promise<boolean> {
  if (!hasActiveWizard(userId, storageContextId)) {
    return false
  }

  const wizardResult = await processWizardMessage(userId, storageContextId, text)

  if (wizardResult.handled) {
    if (wizardResult.buttons !== undefined && wizardResult.buttons.length > 0) {
      // Send message with buttons
      const chatButtons: import('./chat/types.js').ChatButton[] = wizardResult.buttons.map((btn) => ({
        text: btn.text,
        callbackData: `wizard_${btn.action}`,
        style: btn.action === 'cancel' ? 'danger' : 'primary',
      }))
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

export function setupBot(chat: ChatProvider, adminUserId: string): void {
  registerCommands(chat, adminUserId)

  chat.onMessage(async (msg, reply) => {
    // Get authorization FIRST (needed for wizard storage context)
    const auth = checkAuthorizationExtended(
      msg.user.id,
      msg.user.username,
      msg.contextId,
      msg.contextType,
      msg.user.isAdmin,
    )

    // WIZARD INTERCEPTION - Platform agnostic
    // Check if user is in active wizard session AND message is not a command
    // Commands (starting with /) are always routed to their handlers, even during wizard
    const isCommand = msg.text.startsWith('/')

    // AUTO-START WIZARD FOR NEW USERS
    // If user has no config and no active wizard, start wizard automatically
    // This happens only on first interaction after auto-provisioning
    if (!isCommand) {
      const platform = chat.name === 'telegram' || chat.name === 'mattermost' ? chat.name : 'telegram'
      const wasWizardAutoStarted = await autoStartWizardIfNeeded(msg.user.id, auth.storageContextId, platform, reply)
      if (wasWizardAutoStarted) return
    }

    // Use auth.storageContextId (not msg.contextId) for wizard lookup
    // This ensures DM wizards use userId, group wizards use groupId
    if (!isCommand) {
      const wasWizardHandled = await handleWizardMessage(msg.user.id, auth.storageContextId, msg.text, reply)
      if (wasWizardHandled) return
    }

    await handleMessage(msg, reply, auth)
  })
}
