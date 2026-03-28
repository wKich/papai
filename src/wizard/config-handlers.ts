import type { Context } from 'grammy'

import { getConfig, isConfigKey } from '../config.js'
import { createWizard, cancelWizard } from './engine.js'
import { getWizardSession, updateWizardSession } from './state.js'
import { getWizardSteps } from './steps.js'

/**
 * Handle configuration edit callbacks from inline buttons
 */
export async function handleConfigCallback(ctx: Context): Promise<void> {
  const userId = String(ctx.from?.id ?? '')
  const storageContextId = String(ctx.chat?.id ?? userId)
  const data = ctx.callbackQuery?.data ?? ''

  if (!data.startsWith('config_edit_')) return
  await ctx.answerCallbackQuery()

  const key = data.replace('config_edit_', '')
  if (!isConfigKey(key)) {
    await ctx.editMessageText('❌ Invalid configuration field.')
    return
  }

  // Get current value to show user
  const currentValue = getConfig(storageContextId, key)
  const displayValue = currentValue ?? '(not set)'

  // Check if wizard already active
  const existingSession = getWizardSession(userId, storageContextId)
  if (existingSession !== null) {
    // Cancel existing wizard and start fresh for this field
    cancelWizard(userId, storageContextId)
  }

  // Start wizard (creates new session)
  createWizard(userId, storageContextId, 'telegram', 'kaneo')

  // Find the step index for this key
  const steps = getWizardSteps('kaneo')
  const stepIndex = steps.findIndex((s) => s.key === key)

  if (stepIndex === -1) {
    await ctx.editMessageText('❌ This field cannot be edited through the wizard.')
    return
  }

  // Set wizard to the specific step
  updateWizardSession(userId, storageContextId, {
    currentStep: stepIndex,
    data: existingSession?.data ?? {},
  })

  const step = steps[stepIndex]
  const prompt = step?.prompt ?? `Enter new value for ${key}:`

  await ctx.editMessageText(
    `✏️ Editing **${key}**\n\n` +
      `Current value: ${displayValue}\n\n` +
      `${prompt}\n\n` +
      `💡 Type "cancel" to exit without saving.`,
  )
}
