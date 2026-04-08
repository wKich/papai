import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { KaneoProvider } from '../../../src/providers/kaneo/index.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

describe('KaneoProvider', () => {
  const provider = new KaneoProvider(
    {
      apiKey: 'test-key',
      baseUrl: 'https://api.test.com',
    },
    'workspace-1',
  )

  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  afterEach(() => {
    restoreFetch()
  })

  describe('identity', () => {
    test('has correct name', () => {
      expect(provider.name).toBe('kaneo')
    })
  })

  describe('listStatuses', () => {
    test('returns columns from project', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify([{ id: 'col-1', name: 'Todo', icon: null, color: null, isFinal: false }]), {
            status: 200,
          }),
        ),
      )

      const result = await provider.listStatuses('proj-1')

      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Todo')
    })
  })

  describe('createStatus', () => {
    test('creates column and returns it', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify({ id: 'col-2', name: 'Done', icon: null, color: null, isFinal: true }), {
            status: 200,
          }),
        ),
      )

      const result = await provider.createStatus('proj-1', { name: 'Done', isFinal: true })

      if ('status' in result) {
        expect.unreachable('Should not require confirmation')
      } else {
        expect(result.name).toBe('Done')
      }
    })
  })

  describe('updateStatus', () => {
    test('updates column and returns it', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify({ id: 'col-1', name: 'Updated', icon: null, color: null, isFinal: false }), {
            status: 200,
          }),
        ),
      )

      const result = await provider.updateStatus('proj-1', 'col-1', { name: 'Updated' })

      if ('status' in result) {
        expect.unreachable('Should not require confirmation')
      } else {
        expect(result.name).toBe('Updated')
      }
    })
  })

  describe('deleteStatus', () => {
    test('deletes column and returns id', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })))

      const result = await provider.deleteStatus('proj-1', 'col-1')

      if ('status' in result) {
        expect.unreachable('Should not require confirmation')
      } else {
        expect(result.id).toBe('col-1')
      }
    })
  })

  describe('reorderStatuses', () => {
    test('reorders columns', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })))

      await provider.reorderStatuses('proj-1', [{ id: 'col-1', position: 0 }])
    })
  })
})
