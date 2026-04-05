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

import * as _changelogReader from '../src/changelog-reader.js'
import { _resetDrizzleDb } from '../src/db/drizzle.js'
// Capture real module exports BEFORE any test file loads.
// Spread into plain objects to snapshot current values.
import * as _dbIndex from '../src/db/index.js'
import * as _llmOrchestrator from '../src/llm-orchestrator.js'
import * as _logger from '../src/logger.js'
import * as _messageCache from '../src/message-cache/cache.js'
import * as _providersFactory from '../src/providers/factory.js'
import * as _kaneoListColumns from '../src/providers/kaneo/list-columns.js'
import * as _kaneoProvision from '../src/providers/kaneo/provision.js'
import * as _providersRegistry from '../src/providers/registry.js'
import * as _recurring from '../src/recurring.js'
import * as _scheduler from '../src/scheduler.js'

const originals: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['../src/db/index.js', { ..._dbIndex }],
  ['../src/logger.js', { ..._logger }],
  ['../src/message-cache/cache.js', { ..._messageCache }],
  ['../src/providers/kaneo/provision.js', { ..._kaneoProvision }],
  ['../src/providers/kaneo/list-columns.js', { ..._kaneoListColumns }],
  ['../src/recurring.js', { ..._recurring }],
  ['../src/scheduler.js', { ..._scheduler }],
  ['../src/providers/registry.js', { ..._providersRegistry }],
  ['../src/providers/factory.js', { ..._providersFactory }],
  ['../src/changelog-reader.js', { ..._changelogReader }],
  ['../src/llm-orchestrator.js', { ..._llmOrchestrator }],
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
