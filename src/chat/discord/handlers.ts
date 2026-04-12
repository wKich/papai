/**
 * Discord-specific handlers for config editor and wizard button callbacks
 * Bridges the generic config-editor/wizard logic to Discord's channel-based replies
 */

import {
  getEditorSession,
  handleEditorCallback,
  parseCallbackData,
  serializeCallbackData,
} from '../../config-editor/index.js'
import { logger } from '../../logger.js'
import { cancelWizard, getNextPrompt, processWizardMessage } from '../../wizard/engine.js'
import { validateAndSaveWizardConfig } from '../../wizard/save.js'
import { getWizardSession, resetWizardSession } from '../../wizard/state.js'
import type { ButtonChannelLike } from './buttons.js'
import { toActionRows } from './buttons.js'

const log = logger.child({ scope: 'chat:discord:handlers' })

/**
 * Handle a config editor button callback for Discord
 */
export async function handleConfigEditorCallback(
  userId: string,
  storageContextId: string,
  data: string,
  channel: ButtonChannelLike,
): Promise<void> {
  const { action, key } = parseCallbackData(data)

  if (action === null) {
    log.warn({ data, userId, storageContextId }, 'Unknown config editor callback data')
    return
  }

  log.debug({ userId, storageContextId, action, key }, 'Handling Discord config editor callback')

  // Check if there's an active editor session - return early if none
  const session = getEditorSession(userId, storageContextId)
  if (session === null) {
    log.debug({ userId, storageContextId, action }, 'No active editor session, skipping')
    return
  }

  const result = handleEditorCallback(userId, storageContextId, action, key ?? undefined)

  if (!result.handled) {
    log.debug({ action, key, userId, storageContextId }, 'Config editor callback not handled')
    return
  }

  if (result.buttons !== undefined && result.buttons.length > 0) {
    const rows = toActionRows(
      result.buttons.map((btn) => ({
        text: btn.text,
        callbackData: serializeCallbackData(btn),
        style: btn.style,
      })),
    )
    await channel.send({ content: result.response ?? '', components: rows })
  } else {
    await channel.send({ content: result.response ?? '' })
  }
}

async function sendWizardResponse(
  channel: ButtonChannelLike,
  content: string,
  buttons?: Array<{ text: string; action: string; style?: 'primary' | 'secondary' | 'danger' }>,
): Promise<void> {
  if (buttons !== undefined && buttons.length > 0) {
    const rows = toActionRows(
      buttons.map((btn) => ({
        text: btn.text,
        callbackData: `wizard_${btn.action}`,
        style: btn.style,
      })),
    )
    await channel.send({ content, components: rows })
  } else {
    await channel.send({ content })
  }
}

async function handleWizardConfirm(
  userId: string,
  storageContextId: string,
  channel: ButtonChannelLike,
): Promise<void> {
  const result = await validateAndSaveWizardConfig(userId, storageContextId)
  await sendWizardResponse(
    channel,
    result.message,
    result.buttons?.map((b) => ({ ...b, style: 'secondary' as const })),
  )
}

async function handleWizardSkip(
  userId: string,
  storageContextId: string,
  data: 'wizard_skip_small_model' | 'wizard_skip_embedding',
  channel: ButtonChannelLike,
): Promise<void> {
  const skipValue = data === 'wizard_skip_small_model' ? 'same' : 'skip'
  const result = await processWizardMessage(userId, storageContextId, skipValue)
  if (!result.handled) return
  await sendWizardResponse(channel, result.response ?? '', result.buttons)
}

async function handleWizardEdit(userId: string, storageContextId: string, channel: ButtonChannelLike): Promise<void> {
  resetWizardSession(userId, storageContextId)
  await channel.send({
    content: `🔧 Editing configuration from the beginning...\n\n${getNextPrompt(userId, storageContextId)}`,
  })
}

/**
 * Handle a wizard button callback for Discord
 */
export async function handleWizardCallback(
  userId: string,
  storageContextId: string,
  data: string,
  channel: ButtonChannelLike,
): Promise<void> {
  log.debug({ userId, storageContextId, data }, 'Handling Discord wizard callback')

  const session = getWizardSession(userId, storageContextId)
  if (session === null) {
    log.debug({ userId, storageContextId, data }, 'No active wizard session, skipping')
    return
  }

  switch (data) {
    case 'wizard_confirm':
      await handleWizardConfirm(userId, storageContextId, channel)
      return
    case 'wizard_cancel':
      cancelWizard(userId, storageContextId)
      await channel.send({ content: '❌ Wizard cancelled. Type /setup to restart.' })
      return
    case 'wizard_restart':
      cancelWizard(userId, storageContextId)
      await channel.send({ content: 'Restarting wizard... Type /setup to begin.' })
      return
    case 'wizard_edit':
      await handleWizardEdit(userId, storageContextId, channel)
      return
    case 'wizard_skip_small_model':
    case 'wizard_skip_embedding':
      await handleWizardSkip(userId, storageContextId, data, channel)
      return
    default:
      log.debug({ data, userId, storageContextId }, 'Unknown wizard callback data')
  }
}
