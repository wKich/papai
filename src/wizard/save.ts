/**
 * Wizard save and validation logic
 */

import { isConfigKey, setConfig } from '../config.js'
import { logger } from '../logger.js'
import { deleteWizardSession, getWizardSession } from './state.js'
import { validateWizardConfig, type ValidationSummary } from './validation.js'

interface SaveWizardResult {
  readonly success: boolean
  readonly message: string
}

interface ConfigValidationInput {
  apiKey: string
  baseUrl: string
  mainModel: string
  smallModel: string
}

function performConfigValidation(input: ConfigValidationInput): Promise<ValidationSummary> {
  return validateWizardConfig(input)
}

function formatValidationMessage(summary: ValidationSummary): string {
  if (summary.isValid) {
    return ''
  }

  const lines = ['❌ Configuration validation failed:', '', 'Please fix these issues:', '']

  const fieldDisplayNames: Record<string, string> = {
    llm_apikey: 'API Key',
    llm_baseurl: 'Base URL',
    main_model: 'Main Model',
    small_model: 'Small Model',
  }

  for (const error of summary.errors) {
    const displayName = fieldDisplayNames[error.field] ?? error.field
    lines.push(`  • ${displayName}: ${error.message}`)
  }

  lines.push('')
  lines.push('What would you like to do?')
  lines.push('• Type "edit" to review and edit your configuration')
  lines.push('• Type "cancel" to exit without saving')

  return lines.join('\n')
}

function saveValidatedConfig(
  session: NonNullable<ReturnType<typeof getWizardSession>>,
  userId: string,
  storageContextId: string,
): SaveWizardResult {
  let savedCount = 0
  for (const [key, value] of Object.entries(session.data)) {
    if (value !== undefined && value !== '' && isConfigKey(key)) {
      setConfig(session.storageContextId, key, value)
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

export async function validateAndSaveWizardConfig(userId: string, storageContextId: string): Promise<SaveWizardResult> {
  const session = getWizardSession(userId, storageContextId)
  if (session === null) {
    return { success: false, message: 'Error: Wizard session not found' }
  }

  const data = session.data
  const input: ConfigValidationInput = {
    apiKey: data['llm_apikey'] ?? '',
    baseUrl: data['llm_baseurl'] ?? 'https://api.openai.com/v1',
    mainModel: data['main_model'] ?? '',
    smallModel: data['small_model'] ?? '',
  }

  const validationResult = await performConfigValidation(input)

  if (!validationResult.isValid) {
    return {
      success: false,
      message: formatValidationMessage(validationResult),
    }
  }

  return saveValidatedConfig(session, userId, storageContextId)
}
