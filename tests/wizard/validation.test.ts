import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  validateLlmApiKey,
  validateLlmBaseUrl,
  validateModelExists,
  type ValidationResult,
} from '../../src/wizard/validation.js'

describe('validateLlmApiKey', () => {
  test('should return success for valid API key', async () => {
    const result = await validateLlmApiKey('sk-test', 'https://api.openai.com/v1')
    expect(result.success).toBe(true)
  })
})
