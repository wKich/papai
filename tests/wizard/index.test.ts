import { describe, expect, test } from 'bun:test'

import {
  cancelWizard,
  createWizard,
  getNextPrompt,
  getWizardSession,
  hasActiveWizard,
  processWizardMessage,
  resetWizardSession,
  validateAndSaveWizardConfig,
  validateLlmApiKey,
  validateLlmBaseUrl,
  validateModelExists,
} from '../../src/wizard/index.js'

describe('wizard/index exports', () => {
  test('exports all required functions', () => {
    // State exports
    expect(typeof hasActiveWizard).toBe('function')
    expect(typeof getWizardSession).toBe('function')
    expect(typeof resetWizardSession).toBe('function')

    // Engine exports
    expect(typeof processWizardMessage).toBe('function')
    expect(typeof createWizard).toBe('function')
    expect(typeof getNextPrompt).toBe('function')
    expect(typeof cancelWizard).toBe('function')

    // Save exports
    expect(typeof validateAndSaveWizardConfig).toBe('function')

    // Validation exports
    expect(typeof validateLlmApiKey).toBe('function')
    expect(typeof validateLlmBaseUrl).toBe('function')
    expect(typeof validateModelExists).toBe('function')
  })
})
