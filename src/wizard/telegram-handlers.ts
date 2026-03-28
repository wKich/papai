import type { Context } from 'grammy'

import { cancelWizard, createWizard } from './engine.js'
import { validateAndSaveWizardConfig } from './save.js'
import { getWizardSession } from './state.js'

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
      // Get existing session to preserve data
      const session = getWizardSession(userId, storageContextId)
      if (session !== null) {
        // Reset to step 0 to allow editing
        const platform = session.platform
        const taskProvider = session.taskProvider
        cancelWizard(userId, storageContextId)
        const result = createWizard(userId, storageContextId, platform, taskProvider)
        await ctx.editMessageText(result.prompt)
      }
      break
    }
  }
}
