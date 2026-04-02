import { getConfig, isConfigKey, maskValue } from '../config.js'
import type { ConfigKey } from '../types/config.js'
import { createWizard, cancelWizard } from './engine.js'
import { getWizardSession, updateWizardSession } from './state.js'
import { getWizardSteps } from './steps.js'

const TASK_PROVIDER = process.env['TASK_PROVIDER'] === 'youtrack' ? 'youtrack' : 'kaneo'

export interface ConfigCallbackContext {
  from?: { id?: number | string }
  chat?: { id?: number | string }
  callbackQuery?: { data?: string }
  answerCallbackQuery: () => Promise<unknown>
  editMessageText: (text: string) => Promise<unknown>
}

function extractConfigKey(data: string): ConfigKey | null {
  const key = data.replace('config_edit_', '')
  return isConfigKey(key) ? key : null
}

function getDisplayValue(storageContextId: string, key: ConfigKey): string {
  const currentValue = getConfig(storageContextId, key)
  if (currentValue === null) {
    return '(not set)'
  }
  return maskValue(key, currentValue)
}

function findStepIndex(key: ConfigKey): number {
  const steps = getWizardSteps(TASK_PROVIDER)
  return steps.findIndex((s) => s.key === key)
}

function setupWizardForEditing(userId: string, storageContextId: string, key: ConfigKey, stepIndex: number): string {
  const existingSession = getWizardSession(userId, storageContextId)
  if (existingSession !== null) {
    cancelWizard(userId, storageContextId)
  }

  createWizard(userId, storageContextId, 'telegram', TASK_PROVIDER)

  updateWizardSession(userId, storageContextId, {
    currentStep: stepIndex,
    data: existingSession?.data ?? {},
  })

  const steps = getWizardSteps(TASK_PROVIDER)
  const step = steps[stepIndex]
  return step?.prompt ?? `Enter new value for ${key}:`
}

/**
 * Handle configuration edit callbacks from inline buttons
 */
export async function handleConfigCallback(ctx: ConfigCallbackContext): Promise<void> {
  const userId = String(ctx.from?.id ?? '')
  const storageContextId = String(ctx.chat?.id ?? userId)
  const data = ctx.callbackQuery?.data ?? ''

  if (!data.startsWith('config_edit_')) return
  await ctx.answerCallbackQuery()

  const key = extractConfigKey(data)
  if (key === null) {
    await ctx.editMessageText('❌ Invalid configuration field.')
    return
  }

  const displayValue = getDisplayValue(storageContextId, key)
  const stepIndex = findStepIndex(key)

  if (stepIndex === -1) {
    await ctx.editMessageText('❌ This field cannot be edited through the wizard.')
    return
  }

  const prompt = setupWizardForEditing(userId, storageContextId, key, stepIndex)

  await ctx.editMessageText(
    `✏️ Editing **${key}**\n\n` +
      `Current value: ${displayValue}\n\n` +
      `${prompt}\n\n` +
      `💡 Type "cancel" to exit without saving.`,
  )
}
