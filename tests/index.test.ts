import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { mockLogger } from './utils/test-helpers.js'

// Set required environment variables before any imports
process.env['CHAT_PROVIDER'] = 'telegram'
process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
process.env['ADMIN_USER_ID'] = '12345'
process.env['TASK_PROVIDER'] = 'kaneo'
process.env['KANEO_CLIENT_URL'] = 'http://localhost:3000'

// Mock modules before importing index.ts
void mock.module('../src/chat/registry.js', () => ({
  createChatProvider: (): { start: () => Promise<void>; stop: () => Promise<void> } => ({
    start: async (): Promise<void> => {},
    stop: async (): Promise<void> => {},
  }),
}))

void mock.module('../src/db/index.js', () => ({
  initDb: (): void => {},
  closeMigrationDbInstance: (): void => {},
}))

void mock.module('../src/db/drizzle.js', () => ({
  closeDrizzleDb: (): void => {},
}))

void mock.module('../src/message-cache/index.js', () => ({
  initializeMessageCache: (): void => {},
}))

void mock.module('../src/users.js', () => ({
  addUser: (): void => {},
}))

void mock.module('../src/bot.js', () => ({
  setupBot: (): void => {},
}))

void mock.module('../src/announcements.js', () => ({
  announceNewVersion: (): void => {},
}))

void mock.module('../src/chat/startup.js', () => ({
  registerCommandMenuIfSupported: (): void => {},
}))

void mock.module('../src/scheduler.js', () => ({
  startScheduler: (): void => {},
  stopScheduler: (): void => {},
}))

void mock.module('../src/scheduler-instance.js', () => ({
  scheduler: {
    startAll: (): void => {},
    stopAll: (): void => {},
  },
}))

void mock.module('../src/deferred-prompts/poller.js', () => ({
  startPollers: (): void => {},
  stopPollers: (): void => {},
}))

void mock.module('../src/providers/factory.js', () => ({
  buildProviderForUser: (): null => null,
}))

// Import the module under test (src/index.ts) after mocking
import '../src/index.js'

describe('index.ts - graceful shutdown', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('flushOnShutdown is exported from message-queue/index.js', async () => {
    const { flushOnShutdown } = await import('../src/message-queue/index.js')
    expect(flushOnShutdown).toBeDefined()
    expect(typeof flushOnShutdown).toBe('function')
  })

  test('flushOnShutdown accepts timeoutMs option', async () => {
    const { flushOnShutdown } = await import('../src/message-queue/index.js')
    // Call with timeout - should not throw
    await expect(flushOnShutdown({ timeoutMs: 5000 })).resolves.toBeUndefined()
  })
})
