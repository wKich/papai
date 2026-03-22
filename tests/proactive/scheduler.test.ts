import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

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
import { createReminder, listReminders } from '../../src/proactive/reminders.js'
import {
  start,
  stopAll,
  registerBriefingJob,
  unregisterBriefingJob,
  getBriefingJobCount,
  _pollReminders,
  _pollAlerts,
  _fireBriefingIfDue,
  _getBriefingJobs,
} from '../../src/proactive/scheduler.js'
import * as alertService from '../../src/proactive/service.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { createMockProvider } from '../tools/mock-provider.js'

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
  let intervalSpy = spyOn<typeof globalThis, 'setInterval'>(globalThis, 'setInterval')

  beforeEach(async () => {
    await setupTestDb()
    // Reset config by removing all keys
    for (const key of Object.keys(configByUser)) {
      Reflect.deleteProperty(configByUser, key)
    }
    intervalSpy = spyOn<typeof globalThis, 'setInterval'>(globalThis, 'setInterval')
  })

  afterEach(() => {
    stopAll()
    intervalSpy.mockRestore()
  })

  test('start registers 2 global poller jobs (runs without error)', () => {
    const chat = createMockChat()
    const builder = createMockProviderBuilder()

    start(chat, builder)

    expect(intervalSpy).toHaveBeenCalledTimes(2)
  })

  test('start registers one briefing job per user with briefing_time configured', () => {
    configByUser['user1'] = { briefing_time: '08:00', timezone: 'UTC' }
    // user2 has no briefing_time

    const chat = createMockChat()
    const builder = createMockProviderBuilder()
    start(chat, builder)

    expect(getBriefingJobCount()).toBe(1)
  })

  test('registerBriefingJob stops existing job before creating a new one for same userId', () => {
    registerBriefingJob('user-x', '08:00', 'UTC')
    // Only from direct registration, not start()
    expect(getBriefingJobCount()).toBe(1)

    registerBriefingJob('user-x', '09:00', 'UTC')
    // Should still be 1 since the old one was replaced
    expect(getBriefingJobCount()).toBe(1)
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
    expect(getBriefingJobCount()).toBe(2)

    stopAll()
    expect(getBriefingJobCount()).toBe(0)
  })

  test('double start is a no-op', () => {
    const chat = createMockChat()
    const builder = createMockProviderBuilder()
    start(chat, builder)
    // Second call should not throw
    start(chat, builder)
  })

  describe('briefing callback', () => {
    test('error is caught and not rethrown', async () => {
      // Use a provider whose listProjects throws — generateAndRecord will propagate the error
      const brokenBuilder = (_userId: string): TaskProvider =>
        createMockProvider({
          listProjects: (): Promise<never> => {
            throw new Error('provider unavailable')
          },
        })
      start(createMockChat(), brokenBuilder)

      registerBriefingJob('user-briefing-err', '08:00', 'UTC')
      // Force nextRun to the past so the callback actually fires
      const job = _getBriefingJobs().get('user-briefing-err')!
      job.nextRun = new Date(0)

      // Must resolve without throwing (error is caught internally)
      await _fireBriefingIfDue('user-briefing-err', '0 8 * * 1-5', 'UTC')
    })
  })

  describe('alert poller', () => {
    test('error is caught and not rethrown', async () => {
      start(createMockChat(), createMockProviderBuilder())

      // Spy on the live module export so the scheduler sees the mock
      const spy = spyOn(alertService, 'runAlertCycleForAllUsers').mockImplementation((): Promise<void> => {
        throw new Error('alert cycle failed')
      })

      await _pollAlerts()

      spy.mockRestore()
    })
  })

  describe('reminder poller', () => {
    test('marks reminder as delivered after sending', async () => {
      const sent: string[] = []
      const chat = {
        ...createMockChat(),
        sendMessage: (_userId: string, msg: string): Promise<void> => {
          sent.push(msg)
          return Promise.resolve()
        },
      }
      start(chat, createMockProviderBuilder())

      createReminder({
        userId: 'user1',
        text: 'Test reminder',
        fireAt: new Date(Date.now() - 1000).toISOString(),
      })

      await _pollReminders()

      const list = listReminders('user1', true)
      expect(list).toHaveLength(1)
      expect(list[0]!.status).toBe('delivered')
      expect(sent).toHaveLength(1)
      expect(sent[0]).toContain('Test reminder')
    })

    test('calls advanceRecurrence for recurring reminder after delivery', async () => {
      start(createMockChat(), createMockProviderBuilder())

      createReminder({
        userId: 'user1',
        text: 'Daily standup',
        fireAt: new Date(Date.now() - 1000).toISOString(),
        recurrence: '0 9 * * *',
      })

      await _pollReminders()

      // After delivery + advance, reminder should be pending again with a future fire_at
      const list = listReminders('user1')
      expect(list).toHaveLength(1)
      expect(list[0]!.status).toBe('pending')
      expect(new Date(list[0]!.fireAt).getTime()).toBeGreaterThan(Date.now())
    })
  })
})

afterAll(() => {
  mock.restore()
})
