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
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (response.status === 401) {
      return { success: false, message: '❌ Invalid API key. Please check and try again.' }
    }

    if (!response.ok) {
      return { success: false, message: `❌ API error: ${response.status} ${response.statusText}` }
    }

    return { success: true }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'API key validation failed')
    return { success: false, message: '❌ Connection failed. Please check your internet connection.' }
  }
}

export async function validateLlmBaseUrl(baseUrl: string): Promise<ValidationResult> {
  try {
    const response = await fetch(baseUrl, { method: 'HEAD' })
    if (!response.ok && response.status !== 404) {
      return { success: false, message: `❌ Server returned error: ${response.status}` }
    }
    return { success: true }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Base URL validation failed')
    return { success: false, message: '❌ Cannot connect to the provided URL. Please check and try again.' }
  }
}
