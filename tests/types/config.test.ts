/**
 * Tests for config types
 */

import { describe, expect, test } from 'bun:test'

import { isConfigKey, type ConfigKey } from '../../src/types/config.js'

describe('config types', () => {
  describe('isConfigKey', () => {
    test('returns true for valid config keys', () => {
      const validKeys: ConfigKey[] = [
        'llm_apikey',
        'llm_baseurl',
        'main_model',
        'small_model',
        'embedding_model',
        'kaneo_apikey',
        'youtrack_token',
        'timezone',
      ]

      for (const key of validKeys) {
        expect(isConfigKey(key)).toBe(true)
      }
    })

    test('returns false for invalid keys', () => {
      expect(isConfigKey('invalid_key')).toBe(false)
      expect(isConfigKey('')).toBe(false)
      expect(isConfigKey('llm_api_key')).toBe(false)
      expect(isConfigKey('apikey')).toBe(false)
    })

    test('type guard narrows string to ConfigKey', () => {
      const maybeKey = 'llm_apikey'
      if (isConfigKey(maybeKey)) {
        // TypeScript should recognize this as ConfigKey
        const key: ConfigKey = maybeKey
        expect(key).toBe('llm_apikey')
      }
    })
  })
})
