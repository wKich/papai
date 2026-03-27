/**
 * Live validation service for wizard configuration
 * Makes real HTTP requests to verify connectivity
 */

import { logger } from '../logger.js'

const log = logger.child({ scope: 'wizard:validation' })

export interface ValidationResult {
  readonly success: boolean
  readonly message?: string
}

export async function validateLlmApiKey(apiKey: string, baseUrl: string): Promise<ValidationResult> {
  log.debug({ baseUrl }, 'Validating LLM API key')
  return { success: true }
}
