import type { ReplyFn } from '../chat/types.js'
import { renderConfigForTarget } from '../commands/config.js'
import { startSetupForTarget } from '../commands/setup.js'
import type { GroupSettingsSelectorResult } from './types.js'

export type DispatchGroupSelectorDeps = {
  renderConfigForTarget: (reply: ReplyFn, targetContextId: string, interactiveButtons: boolean) => Promise<void>
  startSetupForTarget: (userId: string, reply: ReplyFn, targetContextId: string) => Promise<void>
}

const defaultDeps: DispatchGroupSelectorDeps = {
  renderConfigForTarget,
  startSetupForTarget,
}

/**
 * Dispatches a GroupSettingsSelectorResult to the appropriate reply action.
 * Returns true if the result was handled, false if it was not.
 */
export async function dispatchGroupSelectorResult(
  result: GroupSettingsSelectorResult,
  reply: ReplyFn,
  userId: string,
  interactiveButtons = true,
  deps: DispatchGroupSelectorDeps = defaultDeps,
): Promise<boolean> {
  if (!result.handled) return false

  if ('continueWith' in result) {
    if (result.continueWith.command === 'config') {
      await deps.renderConfigForTarget(reply, result.continueWith.targetContextId, interactiveButtons)
    } else {
      await deps.startSetupForTarget(userId, reply, result.continueWith.targetContextId)
    }
    return true
  }

  if ('buttons' in result && result.buttons !== undefined) {
    if ('replaceButtons' in reply && typeof reply.replaceButtons === 'function') {
      await reply.replaceButtons(result.response, { buttons: result.buttons })
    } else {
      await reply.buttons(result.response, { buttons: result.buttons })
    }
    return true
  }

  if ('response' in result) {
    if ('replaceText' in reply && typeof reply.replaceText === 'function') {
      await reply.replaceText(result.response)
    } else {
      await reply.text(result.response)
    }
    return true
  }

  return false
}
