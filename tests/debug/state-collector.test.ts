import { afterEach, describe, expect, mock, test } from 'bun:test'

import { emit } from '../../src/debug/event-bus.js'
import { addClient, init, removeClient } from '../../src/debug/state-collector.js'
import { resetStats } from '../utils/test-helpers.js'

type MockController = {
  ctrl: ReadableStreamDefaultController
  enqueueMock: ReturnType<typeof mock<(chunk: unknown) => void>>
}

function createMockController(): MockController {
  const enqueueMock = mock<(chunk: unknown) => void>(() => {})
  const closeMock = mock(() => {})
  const ctrl: ReadableStreamDefaultController = {
    enqueue: (chunk: unknown): void => enqueueMock(chunk),
    close: (): void => closeMock(),
    error: (): void => {},
    desiredSize: 1,
  }
  return { ctrl, enqueueMock }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getFirstCallArg(enqueueMock: MockController['enqueueMock']): unknown {
  return enqueueMock.mock.calls[0]?.[0]
}

function parseSseFromUnknown(chunk: unknown): { event: string; data: Record<string, unknown> } {
  const raw = new Uint8Array(chunk instanceof Uint8Array ? chunk : [])
  const text = new TextDecoder().decode(raw)
  const eventMatch = text.match(/^event: (.+)$/m)
  const dataMatch = text.match(/^data: (.+)$/m)
  const parsed: unknown = JSON.parse(dataMatch?.[1] ?? '{}')
  return {
    event: eventMatch?.[1] ?? '',
    data: isRecord(parsed) ? parsed : {},
  }
}

function getAllSseEvents(
  enqueueMock: MockController['enqueueMock'],
): Array<{ event: string; data: Record<string, unknown> }> {
  return enqueueMock.mock.calls.map((call) => parseSseFromUnknown(call[0]))
}

describe('state-collector', () => {
  const controllers: ReadableStreamDefaultController[] = []

  afterEach(() => {
    for (const ctrl of controllers) removeClient(ctrl)
    controllers.length = 0
    resetStats()
  })

  function track(ctrl: ReadableStreamDefaultController): ReadableStreamDefaultController {
    controllers.push(ctrl)
    return ctrl
  }

  test('addClient sends state:init immediately', () => {
    init('admin-1')
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl))

    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const { event, data } = parseSseFromUnknown(getFirstCallArg(enqueueMock))
    expect(event).toBe('state:init')
    expect(data['type']).toBe('state:init')
  })

  test('state:init contains all snapshot sections', () => {
    init('admin-1')
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl))

    const { data } = parseSseFromUnknown(getFirstCallArg(enqueueMock))
    const initData = data['data']
    expect(isRecord(initData)).toBe(true)
    if (!isRecord(initData)) return
    expect(initData).toHaveProperty('sessions')
    expect(initData).toHaveProperty('wizards')
    expect(initData).toHaveProperty('scheduler')
    expect(initData).toHaveProperty('pollers')
    expect(initData).toHaveProperty('messageCache')
    expect(initData).toHaveProperty('stats')
    expect(initData).toHaveProperty('recentLlm')

    const stats = initData['stats']
    expect(isRecord(stats)).toBe(true)
    if (!isRecord(stats)) return
    expect(stats['totalMessages']).toBe(0)
    expect(stats['totalLlmCalls']).toBe(0)
    expect(stats['totalToolCalls']).toBe(0)
  })

  test('admin events are broadcast to clients', () => {
    init('admin-1')
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl))

    emit('message:received', { userId: 'admin-1', textLength: 10 })

    expect(enqueueMock).toHaveBeenCalledTimes(2)
    const events = getAllSseEvents(enqueueMock)
    expect(events[1]?.event).toBe('message:received')
  })

  test('non-admin user events are filtered out', () => {
    init('admin-1')
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl))

    emit('message:received', { userId: 'other-user', textLength: 10 })

    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })

  test('global events (no userId) pass through unfiltered', () => {
    init('admin-1')
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl))

    emit('scheduler:tick', { tickCount: 1, dueTaskCount: 0 })

    expect(enqueueMock).toHaveBeenCalledTimes(2)
    const events = getAllSseEvents(enqueueMock)
    expect(events[1]?.event).toBe('scheduler:tick')
  })

  test('removeClient stops delivery to that client', () => {
    init('admin-1')
    const { ctrl, enqueueMock } = createMockController()
    addClient(ctrl)
    removeClient(ctrl)

    emit('message:received', { userId: 'admin-1', textLength: 5 })

    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })

  test('dead client (enqueue throws) is removed silently', () => {
    init('admin-1')
    const { ctrl, enqueueMock: badEnqueue } = createMockController()
    const { ctrl: goodCtrl, enqueueMock: goodEnqueue } = createMockController()
    addClient(track(ctrl))
    addClient(track(goodCtrl))

    badEnqueue.mockImplementation(() => {
      throw new Error('stream closed')
    })

    expect(() => emit('test:event', { userId: 'admin-1' })).not.toThrow()

    badEnqueue.mockImplementation(() => {})
    emit('test:after', { userId: 'admin-1' })

    expect(goodEnqueue).toHaveBeenCalledTimes(3)
  })
})
