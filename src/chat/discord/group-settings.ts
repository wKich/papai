import { dispatchGroupSelectorResult } from '../../group-settings/dispatch.js'
import { handleGroupSettingsSelectorCallback } from '../../group-settings/selector.js'
import type { ReplyFn } from '../types.js'
import type { ButtonInteractionLike } from './buttons.js'

export function handleDiscordGroupSettingsSelection(
  interaction: ButtonInteractionLike,
  userId: string,
  reply: ReplyFn,
): Promise<boolean> {
  if (!interaction.customId.startsWith('gsel:')) {
    return Promise.resolve(false)
  }

  const result = handleGroupSettingsSelectorCallback(userId, interaction.customId)
  return dispatchGroupSelectorResult(result, reply, userId)
}
