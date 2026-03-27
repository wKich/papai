/**
 * Wizard engine - core orchestration for interactive configuration setup
 */

import { isConfigKey, setConfig } from '../config.js'
import { logger } from '../logger.js'
import type { ConfigKey } from '../types/config.js'
import { createWizardSession, getWizardSession, updateWizardSession, deleteWizardSession } from './state.js'
import { getWizardSteps, getStepByIndex, formatSummary } from './steps.js'
import type { WizardProcessResult } from './types.js'

type TaskProvider = 'kaneo' | 'youtrack'

interface CreateWizardResult {
  readonly success: boolean
  readonly prompt: string
}

interface AdvanceStepResult {
  readonly success: boolean
  readonly prompt: string
  readonly complete?: boolean
  readonly skipped?: boolean
}

interface SaveWizardResult {
  readonly success: boolean
  readonly message: string
}

const WELCOME_MESSAGE = `Welcome to papai configuration wizard!

I'll guide you through setting up your configuration step by step.
You can type "cancel" at any time to exit, or "skip" for optional steps.

Let's begin!`

function normalizeValue(key: ConfigKey, value: string, data: Readonly<Record<string, string | undefined>>): string {
  const trimmedValue = value.trim().toLowerCase()

  if (trimmedValue === 'same' && key === 'small_model') {
    return data['main_model'] ?? value
  }

  if (trimmedValue === 'default' || trimmedValue === 'skip') {
    return ''
  }

  return value.trim()
}

function getNextPrompt(userId: string, storageContextId: string): string {
  const session = getWizardSession(userId, storageContextId)
  if (session === null) return 'Error: Wizard session not found'

  const step = getStepByIndex(session.taskProvider, session.currentStep)
  if (step === undefined) return 'Error: Invalid step index'

  return step.prompt
}

function showSummary(userId: string, storageContextId: string): string {
  const session = getWizardSession(userId, storageContextId)
  if (session === null) return 'Error: Wizard session not found'

  const summary = formatSummary(session.data, session.taskProvider)
  return `${summary}\n\nIs this correct? (yes/confirm to save, or type a value to edit)`
}

function handleSkipCommand(
  session: NonNullable<ReturnType<typeof getWizardSession>>,
  currentStep: NonNullable<ReturnType<typeof getStepByIndex>>,
  userId: string,
  storageContextId: string,
): AdvanceStepResult {
  if (currentStep.isOptional !== true) {
    return {
      success: false,
      prompt: `❌ This step is required and cannot be skipped.\n\n${currentStep.prompt}`,
    }
  }

  updateWizardSession(userId, storageContextId, {
    currentStep: session.currentStep + 1,
    skippedSteps: [session.currentStep],
  })

  logger.info({ userId, storageContextId, stepIndex: session.currentStep }, 'Step skipped')

  const nextSession = getWizardSession(userId, storageContextId)
  if (nextSession === null) return { success: false, prompt: 'Error: Session lost' }

  if (nextSession.currentStep >= nextSession.totalSteps) {
    return { success: true, prompt: showSummary(userId, storageContextId), complete: true, skipped: true }
  }

  return { success: true, prompt: getNextPrompt(userId, storageContextId), skipped: true }
}

async function validateAndStoreValue(
  currentStep: NonNullable<ReturnType<typeof getStepByIndex>>,
  value: string,
  skipValidation: boolean,
): Promise<string | null> {
  if (skipValidation) return null

  const validationError = await currentStep.validate(value)
  if (validationError !== null) {
    return `❌ ${validationError}\n\n${currentStep.prompt}\n\nPlease try again:`
  }

  if (currentStep.liveCheck !== undefined && !currentStep.liveCheck(value)) {
    return `❌ Invalid value. Please check and try again.\n\n${currentStep.prompt}`
  }

  return null
}

function completeStep(
  userId: string,
  storageContextId: string,
  currentStep: NonNullable<ReturnType<typeof getStepByIndex>>,
  value: string,
  session: NonNullable<ReturnType<typeof getWizardSession>>,
): AdvanceStepResult {
  const normalizedValue = normalizeValue(currentStep.key, value, session.data)
  const dataUpdate: Partial<Record<ConfigKey, string>> = {}
  if (normalizedValue !== '') {
    dataUpdate[currentStep.key] = normalizedValue
  }

  updateWizardSession(userId, storageContextId, {
    currentStep: session.currentStep + 1,
    data: dataUpdate,
  })

  logger.info({ userId, storageContextId, stepIndex: session.currentStep, key: currentStep.key }, 'Step completed')

  const updatedSession = getWizardSession(userId, storageContextId)
  if (updatedSession === null) return { success: false, prompt: 'Error: Session lost' }

  if (updatedSession.currentStep >= updatedSession.totalSteps) {
    return { success: true, prompt: showSummary(userId, storageContextId), complete: true }
  }

  return { success: true, prompt: getNextPrompt(userId, storageContextId) }
}

export function createWizard(
  userId: string,
  storageContextId: string,
  platform: 'telegram' | 'mattermost',
  taskProvider: TaskProvider,
): CreateWizardResult {
  const steps = getWizardSteps(taskProvider)

  createWizardSession({
    userId,
    storageContextId,
    totalSteps: steps.length,
    platform,
    taskProvider,
  })

  logger.info({ userId, storageContextId, platform, taskProvider }, 'Wizard created')

  const firstStep = steps[0]
  if (firstStep === undefined) return { success: false, prompt: 'Error: No wizard steps configured' }

  return { success: true, prompt: `${WELCOME_MESSAGE}\n\n${firstStep.prompt}` }
}

export async function advanceStep(
  userId: string,
  storageContextId: string,
  value: string,
  skipValidation = false,
): Promise<AdvanceStepResult> {
  const session = getWizardSession(userId, storageContextId)
  if (session === null) return { success: false, prompt: 'Error: Wizard session not found' }

  const currentStep = getStepByIndex(session.taskProvider, session.currentStep)
  if (currentStep === undefined) return { success: false, prompt: 'Error: Invalid step configuration' }

  const trimmedValue = value.trim().toLowerCase()
  if (trimmedValue === 'skip') {
    return handleSkipCommand(session, currentStep, userId, storageContextId)
  }

  const validationError = await validateAndStoreValue(currentStep, value, skipValidation)
  if (validationError !== null) {
    return { success: false, prompt: validationError }
  }

  return completeStep(userId, storageContextId, currentStep, value, session)
}

export function saveWizardConfig(userId: string, storageContextId: string, confirmed: boolean): SaveWizardResult {
  if (!confirmed) {
    return { success: false, message: 'Configuration not saved. Type "cancel" to exit or continue editing.' }
  }

  const session = getWizardSession(userId, storageContextId)
  if (session === null) return { success: false, message: 'Error: Wizard session not found' }

  let savedCount = 0
  for (const [key, value] of Object.entries(session.data)) {
    if (value !== undefined && value !== '' && isConfigKey(key)) {
      setConfig(userId, key, value)
      savedCount++
    }
  }

  deleteWizardSession(userId, storageContextId)
  logger.info({ userId, storageContextId, savedCount }, 'Configuration saved')

  return {
    success: true,
    message: `✅ Configuration saved successfully! ${savedCount} setting(s) configured.\n\nYou can use /config to view your settings or /set to modify them.`,
  }
}

export function cancelWizard(userId: string, storageContextId: string): void {
  deleteWizardSession(userId, storageContextId)
  logger.info({ userId, storageContextId }, 'Wizard cancelled')
}

export async function processWizardMessage(
  userId: string,
  storageContextId: string,
  text: string,
): Promise<WizardProcessResult> {
  const session = getWizardSession(userId, storageContextId)
  if (session === null) return { handled: false }

  const trimmedText = text.trim().toLowerCase()

  if (trimmedText === 'cancel') {
    cancelWizard(userId, storageContextId)
    return {
      handled: true,
      response: '❌ Wizard cancelled. Your configuration was not saved.\n\nUse /setup to start again.',
    }
  }

  const isComplete = session.currentStep >= session.totalSteps
  if (isComplete && (trimmedText === 'yes' || trimmedText === 'confirm')) {
    const result = saveWizardConfig(userId, storageContextId, true)
    return { handled: true, response: result.message }
  }

  const result = await advanceStep(userId, storageContextId, text)
  return { handled: true, response: result.prompt, requiresInput: true }
}

export { getWizardSteps }
