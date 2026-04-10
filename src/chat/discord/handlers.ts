/**
 * Discord button interaction handlers for wizard and config editor callbacks.
 */

import { handleEditorCallback, hasActiveEditor } from '../../config-editor/index.js'
import { logger } from '../../logger.js'
import {
  cancelWizard,
  getNextPrompt,
  getWizardSession,
  hasActiveWizard,
  processWizardMessage,
  resetWizardSession,
  validateAndSaveWizardConfig,
} from '../../wizard/index.js'
import type { ChatButton } from '../types.js'
import type { ButtonChannelLike } from './buttons.js'
import { createDiscordReplyFn } from './reply-helpers.js'

const log = logger.child({ scope: 'chat:discord:handlers' })

type WizardResult = { handled: boolean; response?: string; buttons?: Array<{ text: string; action: string }> }

function makeReply(channel: ButtonChannelLike): ReturnType<typeof createDiscordReplyFn> {
  return createDiscordReplyFn({ channel, replyToMessageId: undefined })
}

async function sendWizardResult(result: WizardResult, channel: ButtonChannelLike): Promise<void> {
  if (!result.handled) return
  const reply = makeReply(channel)
  const buttons = result.buttons
  if (buttons !== undefined && buttons.length > 0) {
    const chatButtons: ChatButton[] = buttons.map((btn) => ({
      text: btn.text,
      callbackData: `wizard_${btn.action}`,
      style: btn.action === 'cancel' ? 'danger' : ('primary' as const),
    }))
    await reply.buttons(result.response ?? '', { buttons: chatButtons })
  } else {
    await reply.text(result.response ?? '')
  }
}

/**
 * Handle config editor callbacks from Discord button interactions.
 */
export async function handleConfigEditorCallback(
  userId: string,
  contextId: string,
  data: string,
  channel: ButtonChannelLike,
): Promise<void> {
  if (!hasActiveEditor(userId, contextId)) return

  const { parseCallbackData } = await import('../../config-editor/index.js')
  const { action, key } = parseCallbackData(data)

  if (action === null) {
    log.warn({ data }, 'Unknown config editor callback data')
    return
  }

  log.debug({ userId, contextId, action, key }, 'Handling Discord config editor callback')

  const result = handleEditorCallback(userId, contextId, action, key ?? undefined)

  if (!result.handled) {
    log.warn({ action, key }, 'Config editor callback not handled')
    return
  }

  const reply = makeReply(channel)
  const buttons = result.buttons
  if (buttons !== undefined && buttons.length > 0) {
    const chatButtons: ChatButton[] = buttons.map((btn) => ({
      text: btn.text,
      callbackData:
        btn.action === 'edit' && btn.key !== undefined
          ? `cfg:edit:${btn.key}`
          : btn.action === 'save' && btn.key !== undefined
            ? `cfg:save:${btn.key}`
            : `cfg:${btn.action}`,
      style: btn.style ?? 'primary',
    }))
    await reply.buttons(result.response ?? '', { buttons: chatButtons })
  } else {
    await reply.text(result.response ?? '')
  }
}

/**
 * Handle wizard callbacks from Discord button interactions.
 */
export async function handleWizardCallback(
  userId: string,
  contextId: string,
  data: string,
  channel: ButtonChannelLike,
): Promise<void> {
  if (!hasActiveWizard(userId, contextId)) return

  log.debug({ userId, contextId, data }, 'Handling Discord wizard callback')

  switch (data) {
    case 'wizard_confirm': {
      const result = await validateAndSaveWizardConfig(userId, contextId)
      await makeReply(channel).text(result.message)
      return
    }
    case 'wizard_cancel': {
      cancelWizard(userId, contextId)
      await makeReply(channel).text('Wizard cancelled. Type /setup to restart.')
      return
    }
    case 'wizard_restart': {
      cancelWizard(userId, contextId)
      await makeReply(channel).text('Restarting wizard... Type /setup to begin.')
      return
    }
    case 'wizard_edit': {
      const session = getWizardSession(userId, contextId)
      if (session !== null) {
        resetWizardSession(userId, contextId)
        const prompt = getNextPrompt(userId, contextId)
        await makeReply(channel).text(`Editing configuration from the beginning...\n\n${prompt}`)
      }
      return
    }
    case 'wizard_skip_small_model':
    case 'wizard_skip_embedding': {
      const skipValue = data === 'wizard_skip_small_model' ? 'same' : 'skip'
      const result = await processWizardMessage(userId, contextId, skipValue)
      await sendWizardResult(result, channel)
      return
    }
    default: {
      const result = await processWizardMessage(userId, contextId, data)
      await sendWizardResult(result, channel)
    }
  }
}
