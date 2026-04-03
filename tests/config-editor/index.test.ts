/**
 * Tests for config-editor public API
 */

import { afterAll, describe, expect, test } from 'bun:test'
import { mock } from 'bun:test'

import { mockLogger } from '../utils/test-helpers.js'

// Setup mocks
mockLogger()

afterAll(() => {
  mock.restore()
})

// Import from public API
import {
  createEditorSession,
  deleteEditorSession,
  getEditorSession,
  handleEditorCallback,
  handleEditorMessage,
  hasActiveEditor,
  parseCallbackData,
  startEditor,
} from '../../src/config-editor/index.js'

describe('config-editor public API', () => {
  const userId = 'user123'
  const storageContextId = 'ctx456'

  test('exports startEditor function', () => {
    const result = startEditor(userId, storageContextId, 'llm_apikey')
    expect(result.handled).toBe(true)
  })

  test('exports state management functions', () => {
    expect(typeof createEditorSession).toBe('function')
    expect(typeof getEditorSession).toBe('function')
    expect(typeof hasActiveEditor).toBe('function')
    expect(typeof deleteEditorSession).toBe('function')
  })

  test('exports handler functions', () => {
    expect(typeof handleEditorCallback).toBe('function')
    expect(typeof handleEditorMessage).toBe('function')
    expect(typeof parseCallbackData).toBe('function')
  })

  test('parseCallbackData works correctly', () => {
    expect(parseCallbackData('cfg:cancel')).toEqual({ action: 'cancel', key: null })
    expect(parseCallbackData('cfg:back')).toEqual({ action: 'back', key: null })
    expect(parseCallbackData('cfg:setup')).toEqual({ action: 'setup', key: null })
    expect(parseCallbackData('cfg:edit:llm_apikey')).toEqual({ action: 'edit', key: 'llm_apikey' })
    expect(parseCallbackData('cfg:save:main_model')).toEqual({ action: 'save', key: 'main_model' })
    expect(parseCallbackData('invalid')).toEqual({ action: null, key: null })
  })
})
