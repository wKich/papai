import { afterEach, describe, expect, test } from 'bun:test'

import { acquireConversationLock, _clearAllLocks } from '../src/conversation-lock.js'

afterEach(() => {
  _clearAllLocks()
})

describe('acquireConversationLock', () => {
  test('acquires lock immediately when not held', async () => {
    const release = await acquireConversationLock('user-1')
    expect(typeof release).toBe('function')
    release()
  })

  test('second caller waits until first releases', async () => {
    const order: number[] = []

    const release1 = await acquireConversationLock('user-1')
    order.push(1)

    const promise2 = acquireConversationLock('user-1').then((release) => {
      order.push(2)
      release()
    })

    // Give microtask queue a tick — second caller should still be waiting
    await new Promise<void>((r) => {
      setTimeout(r, 10)
    })
    expect(order).toEqual([1])

    release1()
    await promise2

    expect(order).toEqual([1, 2])
  })

  test('FIFO ordering for multiple waiters', async () => {
    const order: number[] = []

    const release1 = await acquireConversationLock('user-1')

    const promise2 = acquireConversationLock('user-1').then((release) => {
      order.push(2)
      release()
    })

    const promise3 = acquireConversationLock('user-1').then((release) => {
      order.push(3)
      release()
    })

    release1()
    await Promise.all([promise2, promise3])

    expect(order).toEqual([2, 3])
  })

  test('independent locks for different users', async () => {
    const release1 = await acquireConversationLock('user-1')
    const release2 = await acquireConversationLock('user-2')

    // Both acquired immediately — no deadlock
    expect(typeof release1).toBe('function')
    expect(typeof release2).toBe('function')

    release1()
    release2()
  })

  test('lock can be re-acquired after release', async () => {
    const release1 = await acquireConversationLock('user-1')
    release1()

    const release2 = await acquireConversationLock('user-1')
    expect(typeof release2).toBe('function')
    release2()
  })

  test('release is idempotent — double release does not crash', async () => {
    const release = await acquireConversationLock('user-1')
    release()
    // Second call should not throw or corrupt state
    release()

    // Should still be able to acquire
    const release2 = await acquireConversationLock('user-1')
    release2()
  })
})
