import { handleEditorCallback, parseCallbackData, serializeCallbackData } from '../config-editor/index.js'
import { logger } from '../logger.js'
import { cancelWizard, getNextPrompt, processWizardMessage } from '../wizard/engine.js'
import { validateAndSaveWizardConfig } from '../wizard/save.js'
import { getWizardSession, resetWizardSession } from '../wizard/state.js'
import type { IncomingInteraction, ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:interaction-router' })

export type InteractionRouteDeps = {
  handleConfigInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>
  handleWizardInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>
}

async function defaultHandleConfigInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<boolean> {
  const { callbackData, user, contextId } = interaction
  if (!callbackData.startsWith('cfg:')) return false

  const { action, key } = parseCallbackData(callbackData)

  if (action === null) {
    log.warn({ callbackData }, 'Unknown config editor callback data')
    return true
  }

  log.debug({ userId: user.id, contextId, action, key }, 'Handling config editor callback')

  const result = handleEditorCallback(user.id, contextId, action, key ?? undefined)

  if (!result.handled) {
    log.warn({ action, key }, 'Config editor callback not handled')
    return true
  }

  if (result.buttons !== undefined && result.buttons.length > 0) {
    await reply.buttons(result.response ?? '', {
      buttons: result.buttons.map((btn) => ({
        text: btn.text,
        callbackData: serializeCallbackData(btn),
      })),
    })
  } else {
    await reply.text(result.response ?? '')
  }

  return true
}

async function replyWithWizardButtons(
  reply: ReplyFn,
  response: string | undefined,
  buttons: Array<{ text: string; action: string }> | undefined,
): Promise<void> {
  if (buttons !== undefined && buttons.length > 0) {
    await reply.buttons(response ?? '', {
      buttons: buttons.map((button) => ({ text: button.text, callbackData: `wizard_${button.action}` })),
    })
    return
  }

  await reply.text(response ?? '')
}

async function handleWizardEdit(userId: string, storageContextId: string, reply: ReplyFn): Promise<boolean> {
  const session = getWizardSession(userId, storageContextId)
  if (session === null) {
    await reply.text('No active setup session. Type /setup to start.')
    return true
  }

  resetWizardSession(userId, storageContextId)
  await reply.text(`🔧 Editing configuration from the beginning...\n\n${getNextPrompt(userId, storageContextId)}`)
  return true
}

async function handleWizardSkip(
  callbackData: 'wizard_skip_small_model' | 'wizard_skip_embedding',
  userId: string,
  storageContextId: string,
  reply: ReplyFn,
): Promise<boolean> {
  const skipValue = callbackData === 'wizard_skip_small_model' ? 'same' : 'skip'
  const result = await processWizardMessage(userId, storageContextId, skipValue)
  if (!result.handled) return true
  await replyWithWizardButtons(reply, result.response, result.buttons)
  return true
}

async function defaultHandleWizardInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<boolean> {
  const { callbackData, user, contextId } = interaction
  if (!callbackData.startsWith('wizard_')) return false

  const userId = user.id
  const storageContextId = contextId

  switch (callbackData) {
    case 'wizard_confirm': {
      const result = await validateAndSaveWizardConfig(userId, storageContextId)
      await replyWithWizardButtons(reply, result.message, result.buttons)
      return true
    }
    case 'wizard_cancel': {
      cancelWizard(userId, storageContextId)
      await reply.text('❌ Wizard cancelled. Type /setup to restart.')
      return true
    }
    case 'wizard_restart': {
      cancelWizard(userId, storageContextId)
      await reply.text('Restarting wizard... Type /setup to begin.')
      return true
    }
    case 'wizard_edit':
      return handleWizardEdit(userId, storageContextId, reply)
    case 'wizard_skip_small_model':
    case 'wizard_skip_embedding':
      return handleWizardSkip(callbackData, userId, storageContextId, reply)
    default:
      return false
  }
}

const defaultDeps: InteractionRouteDeps = {
  handleConfigInteraction: defaultHandleConfigInteraction,
  handleWizardInteraction: defaultHandleWizardInteraction,
}

export function routeInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
  deps: InteractionRouteDeps = defaultDeps,
): Promise<boolean> {
  const { callbackData } = interaction

  if (callbackData.startsWith('cfg:')) {
    return deps.handleConfigInteraction(interaction, reply)
  }

  if (callbackData.startsWith('wizard_')) {
    return deps.handleWizardInteraction(interaction, reply)
  }

  log.debug({ callbackData }, 'No route matched for interaction callback')
  return Promise.resolve(false)
}
