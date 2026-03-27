import { afterEach, describe, expect, mock, test } from 'bun:test'

import { emit } from '../../src/debug/event-bus.js'
import { addClient, removeClient } from '../../src/debug/state-collector.js'

type MockController = {
  ctrl: ReadableStreamDefaultController
  enqueueMock: ReturnType<typeof mock<(chunk: unknown) => void>>
}

function createMockController(): MockController {
  const enqueueMock = mock<(chunk: unknown) => void>(() => {})
  const closeMock = mock(() => {})
  // Build an object matching the shape ReadableStreamDefaultController expects
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

function parseSsePayload(call: [unknown]): { event: string; data: Record<string, unknown> } {
  const raw = new Uint8Array(call[0] instanceof Uint8Array ? call[0] : [])
  const text = new TextDecoder().decode(raw)
  const eventMatch = text.match(/^event: (.+)$/m)
  const dataMatch = text.match(/^data: (.+)$/m)
  const parsed: unknown = JSON.parse(dataMatch?.[1] ?? '{}')
  return {
    event: eventMatch?.[1] ?? '',
    data: isRecord(parsed) ? parsed : {},
  }
}

describe('state-collector', () => {
  const controllers: ReadableStreamDefaultController[] = []

  afterEach(() => {
    for (const ctrl of controllers) removeClient(ctrl)
    controllers.length = 0
  })

  function track(ctrl: ReadableStreamDefaultController): ReadableStreamDefaultController {
    controllers.push(ctrl)
    return ctrl
  }

  test('addClient sends state:init immediately', () => {
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl))

    expect(enqueueMock).toHaveBeenCalledTimes(1)

    const firstCall = enqueueMock.mock.calls[0]
    expect(firstCall).toBeDefined()
    const { event, data } = parseSsePayload(firstCall!)
    expect(event).toBe('state:init')
    expect(data['type']).toBe('state:init')
  })

  test('events broadcast to all connected clients', () => {
    const { ctrl: ctrl1, enqueueMock: enqueue1 } = createMockController()
    const { ctrl: ctrl2, enqueueMock: enqueue2 } = createMockController()
    addClient(track(ctrl1))
    addClient(track(ctrl2))

    emit('test:broadcast', { value: 42 })

    // 1 for state:init + 1 for broadcast
    expect(enqueue1).toHaveBeenCalledTimes(2)
    expect(enqueue2).toHaveBeenCalledTimes(2)

    const secondCall = enqueue1.mock.calls[1]
    expect(secondCall).toBeDefined()
    const { event } = parseSsePayload(secondCall!)
    expect(event).toBe('test:broadcast')
  })

  test('removeClient stops delivery to that client', () => {
    const { ctrl, enqueueMock } = createMockController()
    addClient(ctrl)
    removeClient(ctrl)

    emit('after:remove', {})

    // Only the state:init call, no broadcast
    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })

  test('dead client (enqueue throws) is removed silently', () => {
    const { ctrl, enqueueMock: badEnqueue } = createMockController()
    const { ctrl: goodCtrl, enqueueMock: goodEnqueue } = createMockController()
    addClient(track(ctrl))
    addClient(track(goodCtrl))

    // Make ctrl throw on next enqueue
    badEnqueue.mockImplementation(() => {
      throw new Error('stream closed')
    })

    expect(() => emit('error:test', {})).not.toThrow()

    // Good client still receives events
    badEnqueue.mockImplementation(() => {})
    emit('after:error', {})

    // state:init + error:test + after:error = 3
    expect(goodEnqueue).toHaveBeenCalledTimes(3)
  })
})
