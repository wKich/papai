import { normalizeTimezone } from '../utils/timezone.js'
import type { WizardStep } from './types.js'
import { validateLlmApiKey } from './validation.js'

type TaskProvider = 'kaneo' | 'youtrack'

const PROVIDER_SPECIFIC_STEP: Record<TaskProvider, { key: 'kaneo_apikey' | 'youtrack_token'; prompt: string }> = {
  kaneo: {
    key: 'kaneo_apikey',
    prompt: '🔑 Enter your Kaneo API key:',
  },
  youtrack: {
    key: 'youtrack_token',
    prompt: '🔑 Enter your YouTrack token:',
  },
}

function createStep(
  id: string,
  key: WizardStep['key'],
  prompt: string,
  isOptional?: boolean,
  liveCheck?: WizardStep['liveCheck'],
): WizardStep {
  return {
    id,
    key,
    prompt,
    validate: (value: string) => Promise.resolve(validateStep(key, value)),
    liveCheck,
    isOptional,
  }
}

export function getWizardSteps(taskProvider: TaskProvider): WizardStep[] {
  const providerStep = PROVIDER_SPECIFIC_STEP[taskProvider]

  return [
    createStep('llm_apikey', 'llm_apikey', '🔑 Enter your LLM API key:', undefined, (value: string) =>
      validateLlmApiKey(value, 'https://api.openai.com/v1'),
    ),
    createStep('llm_baseurl', 'llm_baseurl', "🌐 Enter base URL (or 'default' for OpenAI):"),
    createStep('main_model', 'main_model', '🤖 Enter main model name (e.g., gpt-4, claude-3-opus):'),
    createStep('small_model', 'small_model', "⚡ Enter small model name (or 'same' to use main model):"),
    createStep('embedding_model', 'embedding_model', "📊 Enter embedding model (or 'skip' to use default):", true),
    createStep(providerStep.key, providerStep.key, providerStep.prompt),
    createStep('timezone', 'timezone', '🌍 Enter your timezone (e.g., America/New_York, UTC, UTC+5):'),
  ]
}

function validateApiKey(value: string): string | null {
  return value.trim().length === 0 ? 'API key cannot be empty' : null
}

function validateToken(value: string): string | null {
  return value.trim().length === 0 ? 'Token cannot be empty' : null
}

function validateUrl(value: string): string | null {
  const trimmedValue = value.trim()
  if (trimmedValue === 'default') {
    return null
  }
  try {
    const url = new URL(trimmedValue)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Please enter a valid URL (http/https) or "default"'
    }
    return null
  } catch {
    return 'Please enter a valid URL (http/https) or "default"'
  }
}

function validateModel(value: string): string | null {
  return value.trim().length === 0 ? 'Model name cannot be empty' : null
}

function validateTimezone(value: string): string | null {
  return normalizeTimezone(value.trim()) === null
    ? 'Invalid timezone. Please enter a valid IANA timezone (e.g., America/New_York, UTC) or UTC offset (e.g., UTC+5)'
    : null
}

export function validateStep(stepId: string, value: string): Promise<string | null> {
  const result = ((): string | null => {
    switch (stepId) {
      case 'llm_apikey':
      case 'kaneo_apikey':
        return validateApiKey(value)
      case 'youtrack_token':
        return validateToken(value)
      case 'llm_baseurl':
        return validateUrl(value)
      case 'main_model':
      case 'small_model':
      case 'embedding_model':
        return validateModel(value)
      case 'timezone':
        return validateTimezone(value)
      default:
        return null
    }
  })()

  return Promise.resolve(result)
}

export function getStepByIndex(taskProvider: TaskProvider, index: number): WizardStep | undefined {
  const steps = getWizardSteps(taskProvider)
  return steps[index]
}

function maskValue(value: string): string {
  if (value.length <= 8) {
    return value
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function getMaskedValue(value: string | undefined): string {
  if (value === undefined || value === '') {
    return 'Not set'
  }
  return maskValue(value)
}

export function formatSummary(data: Record<string, string | undefined>, taskProvider: TaskProvider): string {
  const lines = ['Configuration Summary', '===================', '']

  // LLM Configuration
  lines.push(`LLM API Key: ${getMaskedValue(data['llm_apikey'])}`)
  lines.push(`Base URL: ${data['llm_baseurl'] ?? 'Not set'}`)
  lines.push(`Main Model: ${data['main_model'] ?? 'Not set'}`)
  lines.push(`Small Model: ${data['small_model'] ?? 'Not set'}`)

  const embeddingModel = data['embedding_model']
  if (embeddingModel !== undefined) {
    lines.push(`Embedding Model: ${embeddingModel}`)
  }

  lines.push('')

  // Provider-specific
  if (taskProvider === 'kaneo') {
    lines.push(`Kaneo API Key: ${getMaskedValue(data['kaneo_apikey'])}`)
  } else if (taskProvider === 'youtrack') {
    lines.push(`YouTrack Token: ${getMaskedValue(data['youtrack_token'])}`)
  }

  lines.push('')

  // Preferences
  lines.push(`Timezone: ${data['timezone'] ?? 'Not set'}`)

  return lines.join('\n')
}
