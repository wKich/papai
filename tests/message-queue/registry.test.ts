import { describe, expect, test, beforeEach } from 'bun:test'
import { QueueRegistry } from '../../src/message-queue/registry.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('QueueRegistry', () => {
  let registry: QueueRegistry

  beforeEach(() => {
    mockLogger()
    registry = new QueueRegistry()
  })

  test('should create queue for new context', () => {
    const queue = registry.getOrCreate('user123')
    expect(queue).toBeDefined()
    expect(queue.getBufferedCount()).toBe(0)
  })

  test('should return same queue for same context', () => {
    const queue1 = registry.getOrCreate('user123')
    const queue2 = registry.getOrCreate('user123')
    expect(queue1).toBe(queue2)
  })

  test('should return different queues for different contexts', () => {
    const queue1 = registry.getOrCreate('user123')
    const queue2 = registry.getOrCreate('user456')
    expect(queue1).not.toBe(queue2)
  })

  test('should get existing queue', () => {
    registry.getOrCreate('user123')
    const queue = registry.get('user123')
    expect(queue).toBeDefined()
    expect(queue!.getBufferedCount()).toBe(0)
  })

  test('should return undefined for non-existent queue', () => {
    const queue = registry.get('nonexistent')
    expect(queue).toBeUndefined()
  })

  test('should get all queues', () => {
    registry.getOrCreate('user123')
    registry.getOrCreate('user456')
    const queues = registry.getAllQueues()
    expect(queues.size).toBe(2)
    expect(queues.has('user123')).toBe(true)
    expect(queues.has('user456')).toBe(true)
  })
})
