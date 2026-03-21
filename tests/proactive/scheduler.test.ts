import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { mockLogger, setupTestDb, mockDrizzle } from '../utils/test-helpers.js'

mockLogger()
mockDrizzle()

// Mock users module
void mock.module('../../src/users.js', () => ({
  listUsers: (): Array<{ platform_user_id: string; username: string | null }> => [
    { platform_user_id: 'user1', username: 'alice' },
    { platform_user_id: 'user2', username: 'bob' },
  ],
  addUser: (): void => {},
  isAuthorized: (): boolean => true,
  getKaneoWorkspace: (): string | null => null,
}))

// Mock config
const configByUser: Record<string, Record<string, string>> = {}
void mock.module('../../src/config.js', () => ({
  getConfig: (userId: string, key: string): string | null => configByUser[userId]?.[key] ?? null,
  isConfigKey: (): boolean => true,
  getAllConfig: (): Record<string, string> => ({}),
  setConfig: (): void => {},
  maskValue: (_k: string, v: string): string => v,
}))

import type { ChatProvider } from '../../src/chat/types.js'
import {
  start,
  stopAll,
  registerBriefingJob,
  unregisterBriefingJob,
  _briefingJobs,
} from '../../src/proactive/scheduler.js'
import type { TaskProvider } from '../../src/providers/types.js'

const createMockChat = (): ChatProvider => ({
  name: 'mock',
  registerCommand: (): void => {},
  onMessage: (): void => {},
  sendMessage: async (): Promise<void> => {},
  start: async (): Promise<void> => {},
  stop: async (): Promise<void> => {},
})

const createMockProviderBuilder = (): ((userId: string) => TaskProvider | null) => () => null

describe('ProactiveAlertScheduler', () => {
  beforeEach(async () => {
    await setupTestDb()
    // Reset config by removing all keys
    for (const key of Object.keys(configByUser)) {
      Reflect.deleteProperty(configByUser, key)
    }
  })

  afterEach(() => {
    stopAll()
  })

  test('start registers 2 global poller jobs (runs without error)', () => {
    const chat = createMockChat()
    const builder = createMockProviderBuilder()
    const intervalSpy = mock.spy(globalThis, 'setInterval')

    start(chat, builder)

    expect(intervalSpy).toHaveBeenCalledTimes(2)
  })

  test('start registers one briefing job per user with briefing_time configured', () => {
    configByUser['user1'] = { briefing_time: '08:00', timezone: 'UTC' }
    // user2 has no briefing_time

    const chat = createMockChat()
    const builder = createMockProviderBuilder()
    start(chat, builder)

    expect(_briefingJobs.size).toBe(1)
  })

  test('registerBriefingJob stops existing job before creating a new one for same userId', () => {
    registerBriefingJob('user-x', '08:00', 'UTC')
    // Only from direct registration, not start()
    expect(_briefingJobs.size).toBe(1)

    registerBriefingJob('user-x', '09:00', 'UTC')
    // Should still be 1 since the old one was replaced
    expect(_briefingJobs.size).toBe(1)
  })

  test('unregisterBriefingJob is a no-op when userId has no job', () => {
    expect(() => unregisterBriefingJob('nonexistent')).not.toThrow()
  })

  test('stopAll stops all registered cron jobs', () => {
    const chat = createMockChat()
    const builder = createMockProviderBuilder()

    configByUser['user1'] = { briefing_time: '08:00', timezone: 'UTC' }
    configByUser['user2'] = { briefing_time: '09:00', timezone: 'America/New_York' }

    start(chat, builder)
    expect(_briefingJobs.size).toBe(2)

    stopAll()
    expect(_briefingJobs.size).toBe(0)
  })

  test('double start is a no-op', () => {
    const chat = createMockChat()
    const builder = createMockProviderBuilder()
    start(chat, builder)
    // Second call should not throw
    start(chat, builder)
  })
})
