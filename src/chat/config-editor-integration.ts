/**
 * Config Editor integration for chat handlers
 * Bridges config-editor with ReplyFn
 */

import { handleEditorMessage, hasActiveEditor, serializeCallbackData } from '../config-editor/index.js'
import type { ChatButton, ReplyFn } from './types.js'

/**
 * Handle a text message for config editor
 * Returns true if handled by config editor
 */
export async function handleConfigEditorMessage(
  userId: string,
  storageContextId: string,
  text: string,
  reply: ReplyFn,
): Promise<boolean> {
  if (!hasActiveEditor(userId, storageContextId)) {
    return false
  }

  const result = handleEditorMessage(userId, storageContextId, text)

  if (result.handled) {
    const buttons = result.buttons
    if (buttons !== undefined && buttons.length > 0) {
      const chatButtons: ChatButton[] = buttons.map((btn) => ({
        text: btn.text,
        callbackData: serializeCallbackData(btn),
        style: btn.style ?? 'primary',
      }))
      await reply.buttons(result.response ?? '', { buttons: chatButtons })
    } else if (result.response !== undefined && result.response !== '') {
      await reply.text(result.response)
    }
    return true
  }

  return false
}
