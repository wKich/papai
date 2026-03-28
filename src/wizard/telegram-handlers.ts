import type { Context } from 'grammy'

import { cancelWizard, createWizard, processWizardMessage } from './engine.js'
import { validateAndSaveWizardConfig } from './save.js'
import { getWizardSession } from './state.js'

async function handleSkipButton(ctx: Context, userId: string, storageContextId: string, data: string): Promise<void> {
  const skipValue = data === 'wizard_skip_small_model' ? 'same' : 'skip'
  const result = await processWizardMessage(userId, storageContextId, skipValue)

  if (!result.handled) return

  if (result.buttons !== undefined && result.buttons.length > 0) {
    const keyboard = {
      inline_keyboard: result.buttons.map((btn) => [{ text: btn.text, callback_data: `wizard_${btn.action}` }]),
    }
    await ctx.reply(result.response ?? '', { reply_markup: keyboard })
  } else {
    await ctx.reply(result.response ?? '')
  }
}

export async function handleWizardCallback(ctx: Context): Promise<void> {
  const userId = String(ctx.from?.id ?? '')
  const storageContextId = String(ctx.chat?.id ?? userId)
  const data = ctx.callbackQuery?.data ?? ''

  if (!data.startsWith('wizard_')) return
  await ctx.answerCallbackQuery()

  switch (data) {
    case 'wizard_confirm': {
      const result = await validateAndSaveWizardConfig(userId, storageContextId)
      await ctx.editMessageText(result.message)
      break
    }
    case 'wizard_cancel':
      cancelWizard(userId, storageContextId)
      await ctx.editMessageText('❌ Wizard cancelled. Type /setup to restart.')
      break
    case 'wizard_restart':
      cancelWizard(userId, storageContextId)
      await ctx.reply('Restarting wizard... Type /setup to begin.')
      break
    case 'wizard_edit': {
      const session = getWizardSession(userId, storageContextId)
      if (session !== null) {
        const { platform, taskProvider } = session
        cancelWizard(userId, storageContextId)
        const result = createWizard(userId, storageContextId, platform, taskProvider)
        await ctx.editMessageText(result.prompt)
      }
      break
    }
    case 'wizard_skip_small_model':
    case 'wizard_skip_embedding':
      await handleSkipButton(ctx, userId, storageContextId, data)
      break
  }
}
