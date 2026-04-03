/**
 * Telegram config editor callback handlers
 * Bridges Telegram callback queries to the config-editor module
 */

import type { Context } from 'grammy'

import { handleEditorCallback, parseCallbackData, type EditorButton } from '../../config-editor/index.js'
import { logger } from '../../logger.js'

const log = logger.child({ scope: 'telegram:config-editor' })

/**
 * Handle config editor callbacks from Telegram inline buttons
 * Returns true if handled, false if not a config editor callback
 */
export async function handleConfigEditorCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data ?? ''

  if (!data.startsWith('cfg:')) {
    return false
  }

  const userId = String(ctx.from?.id ?? '')
  const storageContextId = String(ctx.chat?.id ?? userId)

  await ctx.answerCallbackQuery()

  const { action, key } = parseCallbackData(data)

  if (action === null) {
    log.warn({ data }, 'Unknown config editor callback data')
    return true
  }

  log.debug({ userId, storageContextId, action, key }, 'Handling config editor callback')

  const result = handleEditorCallback(userId, storageContextId, action, key ?? undefined)

  if (!result.handled) {
    log.warn({ action, key }, 'Config editor callback not handled')
    return true
  }

  // Convert editor buttons to Telegram inline keyboard
  const buttons = result.buttons
  if (buttons !== undefined && buttons.length > 0) {
    const keyboard = {
      inline_keyboard: buildKeyboardRows(buttons),
    }
    await ctx.reply(result.response ?? '', { reply_markup: keyboard })
  } else {
    await ctx.reply(result.response ?? '')
  }

  return true
}

/**
 * Build Telegram inline keyboard rows from editor buttons
 * Groups buttons into rows of 2
 */
function buildKeyboardRows(buttons: EditorButton[]): Array<Array<{ text: string; callback_data: string }>> {
  const rows: Array<Array<{ text: string; callback_data: string }>> = []

  for (let i = 0; i < buttons.length; i += 2) {
    const row: Array<{ text: string; callback_data: string }> = []

    const btn1 = buttons[i]
    if (btn1 !== undefined) {
      row.push({
        text: btn1.text,
        callback_data: buildCallbackData(btn1),
      })
    }

    const btn2 = buttons[i + 1]
    if (btn2 !== undefined) {
      row.push({
        text: btn2.text,
        callback_data: buildCallbackData(btn2),
      })
    }

    if (row.length > 0) {
      rows.push(row)
    }
  }

  return rows
}

/**
 * Build callback data string from an editor button
 */
function buildCallbackData(button: EditorButton): string {
  switch (button.action) {
    case 'edit':
      return button.key === undefined ? 'cfg:back' : `cfg:edit:${button.key}`
    case 'save':
      return button.key === undefined ? 'cfg:back' : `cfg:save:${button.key}`
    case 'cancel':
      return 'cfg:cancel'
    case 'back':
      return 'cfg:back'
    case 'setup':
      return 'cfg:setup'
    default:
      return 'cfg:back'
  }
}
