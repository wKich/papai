/**
 * Main E2E test entry point
 *
 * This file orchestrates all E2E tests. Setup/teardown is handled globally
 * via bun-test-setup.ts (loaded via --preload flag in package.json).
 * Run with: bun test tests/e2e/e2e.test.ts
 */

import { describe, setDefaultTimeout, afterAll } from 'bun:test'

import { cleanupE2E } from './global-setup.js'

// Increase timeout for E2E tests
setDefaultTimeout(60000)

// Import all test suites
// Each suite will use the shared Docker containers (setup by bun-test-setup.ts)
import './column-management.test.js'
import './error-handling.test.js'
import './label-operations.test.js'
import './project-lifecycle.test.js'
import './project-management.test.js'
import './task-archive.test.js'
import './task-comments.test.js'
import './task-lifecycle.test.js'
import './task-relations.test.js'
import './task-search.test.js'
import './user-workflows.test.js'

describe('E2E Test Suite', () => {
  // This describe block ensures proper nesting
  // All imported test suites will be children of this describe block
  // Global setup/teardown is handled by bun-test-setup.ts via --preload

  afterAll(async () => {
    await cleanupE2E()
  })
})
