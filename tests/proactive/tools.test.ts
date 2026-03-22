import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, setupTestDb, mockDrizzle } from '../utils/test-helpers.js'

mockLogger()
mockDrizzle()

void mock.module('../../src/config.js', () => ({
  getConfig: (_userId: string, key: string): string | null => {
    if (key === 'briefing_mode') return 'full'
    if (key === 'timezone') return 'UTC'
    return null
  },
  isConfigKey: (): boolean => true,
  getAllConfig: (): Record<string, string> => ({}),
  setConfig: (): void => {},
  maskValue: (_k: string, v: string): string => v,
}))

import type { ToolSet } from 'ai'

import { makeProactiveTools } from '../../src/proactive/tools.js'

const userId = 'test-user'
const toolCtx = { toolCallId: 'tc1', messages: [] as never[] }

function getResultProperty(result: unknown, key: string): unknown {
  if (typeof result !== 'object' || result === null) return undefined
  return Object.getOwnPropertyDescriptor(result, key)?.value
}

const exec = (tools: ToolSet, name: string, args: Record<string, unknown>): Promise<unknown> => {
  const t = tools[name]
  if (t?.execute === undefined) throw new Error(`Tool ${name} not found`)
  const result: unknown = t.execute(args, toolCtx)
  return result instanceof Promise ? result : Promise.resolve(result)
}

describe('Proactive Tools', () => {
  let tools: ToolSet

  beforeEach(async () => {
    await setupTestDb()
    tools = makeProactiveTools(userId, createMockProvider())
  })

  test('makeProactiveTools returns all 6 tools', () => {
    const names = Object.keys(tools)
    expect(names).toContain('set_reminder')
    expect(names).toContain('list_reminders')
    expect(names).toContain('cancel_reminder')
    expect(names).toContain('snooze_reminder')
    expect(names).toContain('reschedule_reminder')
    expect(names).toContain('get_briefing')
    expect(names).toHaveLength(6)
  })

  describe('set_reminder', () => {
    test('creates reminder and returns confirmation', async () => {
      const result: unknown = await exec(tools, 'set_reminder', {
        text: 'Test reminder',
        fireAt: new Date(Date.now() + 3600000).toISOString(),
      })
      expect(result).toHaveProperty('status', 'created')
      expect(result).toHaveProperty('reminderId')
      expect(result).toHaveProperty('text', 'Test reminder')
    })

    test('returns error object for past fireAt', async () => {
      const result: unknown = await exec(tools, 'set_reminder', {
        text: 'Too late',
        fireAt: new Date(Date.now() - 60000).toISOString(),
      })
      expect(result).toHaveProperty('error')
    })

    test('returns error object for invalid cron expression', async () => {
      const result: unknown = await exec(tools, 'set_reminder', {
        text: 'Bad cron',
        fireAt: new Date(Date.now() + 3600000).toISOString(),
        recurrence: 'not a cron',
      })
      expect(result).toHaveProperty('error')
    })
  })

  describe('list_reminders', () => {
    test('returns formatted list of pending reminders', async () => {
      await exec(tools, 'set_reminder', {
        text: 'My reminder',
        fireAt: new Date(Date.now() + 3600000).toISOString(),
      })
      const result: unknown = await exec(tools, 'list_reminders', { includeDelivered: false })
      expect(result).toHaveProperty('reminders')
    })

    test('returns empty message when no reminders', async () => {
      const result: unknown = await exec(tools, 'list_reminders', { includeDelivered: false })
      expect(result).toHaveProperty('message')
    })
  })

  describe('cancel_reminder', () => {
    test('calls service.cancelReminder and returns confirmation', async () => {
      const created: unknown = await exec(tools, 'set_reminder', {
        text: 'To cancel',
        fireAt: new Date(Date.now() + 3600000).toISOString(),
      })
      const reminderId = getResultProperty(created, 'reminderId')
      const result: unknown = await exec(tools, 'cancel_reminder', { reminderId })
      expect(result).toHaveProperty('status', 'cancelled')
    })

    test('surfaces not-found error for unknown reminderId', async () => {
      const result: unknown = await exec(tools, 'cancel_reminder', { reminderId: 'nonexistent' })
      expect(result).toHaveProperty('error')
    })
  })

  describe('snooze_reminder', () => {
    test('calls service.snoozeReminder and returns new fire_at', async () => {
      const created: unknown = await exec(tools, 'set_reminder', {
        text: 'To snooze',
        fireAt: new Date(Date.now() + 3600000).toISOString(),
      })
      const reminderId = getResultProperty(created, 'reminderId')
      const newFireAt = new Date(Date.now() + 7200000).toISOString()
      const result: unknown = await exec(tools, 'snooze_reminder', { reminderId, newFireAt })
      expect(result).toHaveProperty('status', 'snoozed')
      expect(result).toHaveProperty('newFireAt', newFireAt)
    })
  })

  describe('reschedule_reminder', () => {
    test('calls service.rescheduleReminder and returns confirmation', async () => {
      const created: unknown = await exec(tools, 'set_reminder', {
        text: 'To reschedule',
        fireAt: new Date(Date.now() + 3600000).toISOString(),
      })
      const reminderId = getResultProperty(created, 'reminderId')
      const newFireAt = new Date(Date.now() + 10800000).toISOString()
      const result: unknown = await exec(tools, 'reschedule_reminder', { reminderId, newFireAt })
      expect(result).toHaveProperty('status', 'rescheduled')
    })
  })

  describe('get_briefing', () => {
    test('calls briefingService.generate with configured mode', async () => {
      const result: unknown = await exec(tools, 'get_briefing', {})
      expect(result).toHaveProperty('briefing')
    })

    test('uses provided mode over configured mode', async () => {
      const result: unknown = await exec(tools, 'get_briefing', { mode: 'short' })
      expect(result).toHaveProperty('briefing')
    })
  })
})

afterAll(() => {
  mock.restore()
})
