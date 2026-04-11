import { renderConfigForTarget } from '../../commands/config.js'
import { startSetupForTarget } from '../../commands/setup.js'
import { handleGroupSettingsSelectorCallback } from '../../group-settings/selector.js'
import { getActiveGroupSettingsTarget } from '../../group-settings/state.js'
import { logger } from '../../logger.js'
import type { ReplyFn } from '../types.js'
import type { ButtonInteractionLike } from './buttons.js'

const log = logger.child({ scope: 'chat:discord:group-settings' })

export function getDiscordSettingsTargetContextId(
  contextType: 'dm' | 'group',
  contextId: string,
  userId: string,
): string {
  if (contextType !== 'dm') {
    return contextId
  }
  return getActiveGroupSettingsTarget(userId) ?? contextId
}

export async function handleDiscordGroupSettingsSelection(
  interaction: ButtonInteractionLike,
  userId: string,
  reply: ReplyFn,
): Promise<boolean> {
  if (!interaction.customId.startsWith('gsel:')) {
    return false
  }

  try {
    await interaction.deferUpdate()
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error), customId: interaction.customId },
      'Failed to defer Discord group-settings interaction',
    )
  }

  const result = handleGroupSettingsSelectorCallback(userId, interaction.customId)
  if (!result.handled) {
    return false
  }
  if ('continueWith' in result) {
    if (result.continueWith.command === 'config') {
      await renderConfigForTarget(reply, result.continueWith.targetContextId, true)
    } else {
      await startSetupForTarget(userId, reply, result.continueWith.targetContextId)
    }
    return true
  }
  if ('buttons' in result && result.buttons !== undefined) {
    await reply.buttons(result.response, { buttons: result.buttons })
    return true
  }
  if ('response' in result) {
    await reply.text(result.response)
    return true
  }
  return false
}
