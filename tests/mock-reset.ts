/**
 * Global mock reset preload.
 *
 * Captures real exports of all commonly-mocked modules at startup (before any
 * test file can mock them), then restores originals in a global beforeEach.
 * Individual test files override in their own describe-level beforeEach.
 *
 * Order per test:
 *   global beforeEach (restore originals) -> file beforeEach (apply mocks) -> test -> global afterEach (restore spies)
 */

import { afterEach, beforeEach, mock } from 'bun:test'

import * as _openaiCompat from '@ai-sdk/openai-compatible'
import * as _ai from 'ai'

import { _resetDrizzleDb } from '../src/db/drizzle.js'
// Capture real module exports BEFORE any test file loads.
// Spread into plain objects to snapshot current values.
import * as _logger from '../src/logger.js'
import * as _messageCache from '../src/message-cache/cache.js'

const originals: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['../src/logger.js', { ..._logger }],
  ['../src/message-cache/cache.js', { ..._messageCache }],
  ['ai', { ..._ai }],
  ['@ai-sdk/openai-compatible', { ..._openaiCompat }],
]

beforeEach(() => {
  _resetDrizzleDb()
  for (const [path, exports] of originals) {
    void mock.module(path, () => ({ ...exports }))
  }
})

afterEach(() => {
  mock.restore()
})
