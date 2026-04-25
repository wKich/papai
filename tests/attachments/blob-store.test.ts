import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  buildBlobKey,
  createInMemoryBlobStore,
  getBlobStore,
  resetBlobStore,
  setBlobStore,
} from '../../src/attachments/blob-store.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('blob-store DI', () => {
  beforeEach(() => {
    mockLogger()
  })

  afterEach(() => {
    resetBlobStore()
    delete process.env['S3_PREFIX']
  })

  test('round-trips bytes through the in-memory store and supports delete', async () => {
    const store = createInMemoryBlobStore()
    setBlobStore(store)

    await getBlobStore().put('ctx/key-1', Buffer.from('hello'), 'text/plain')
    expect((await getBlobStore().get('ctx/key-1')).toString('utf8')).toBe('hello')

    await getBlobStore().delete('ctx/key-1')
    await expect(getBlobStore().get('ctx/key-1')).rejects.toThrow()
  })

  test('deleteMany removes a batch of keys at once', async () => {
    const store = createInMemoryBlobStore()
    setBlobStore(store)

    await store.put('a', Buffer.from('1'))
    await store.put('b', Buffer.from('2'))
    await store.put('c', Buffer.from('3'))
    expect(store.size()).toBe(3)

    await store.deleteMany(['a', 'b'])

    expect(store.has('a')).toBe(false)
    expect(store.has('b')).toBe(false)
    expect(store.has('c')).toBe(true)
  })

  test('buildBlobKey honours an optional S3_PREFIX', () => {
    delete process.env['S3_PREFIX']
    expect(buildBlobKey('ctx-1', 'att_1')).toBe('ctx-1/att_1')

    process.env['S3_PREFIX'] = 'envname'
    expect(buildBlobKey('ctx-1', 'att_1')).toBe('envname/ctx-1/att_1')

    process.env['S3_PREFIX'] = 'envname/'
    expect(buildBlobKey('ctx-1', 'att_1')).toBe('envname/ctx-1/att_1')
  })
})
