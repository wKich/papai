import { describe, test, expect, beforeEach, afterEach } from 'bun:test'

import { resolveStateBundle, clearBundleCache } from '../../../src/providers/youtrack/bundle-cache.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

describe('bundle-cache', () => {
  const config = { baseUrl: 'https://example.com', token: 'test-token' }

  beforeEach(() => {
    restoreFetch()
    clearBundleCache()
  })

  afterEach(() => {
    restoreFetch()
  })

  describe('resolveStateBundle', () => {
    test('fetches and caches bundle info', async () => {
      let callCount = 0
      setMockFetch(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  $type: 'StateProjectCustomField',
                  field: { name: 'State' },
                  bundle: { id: 'bundle-123', $type: 'StateBundle' },
                },
              ]),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'bundle-123',
              aggregated: { project: [{ id: 'proj-1' }, { id: 'proj-2' }] },
            }),
            { status: 200 },
          ),
        )
      })

      const result = await resolveStateBundle(config, 'proj-1')

      expect(result).toEqual({ bundleId: 'bundle-123', isShared: true })
    })

    test('returns null when State field not found', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))

      const result = await resolveStateBundle(config, 'proj-1')

      expect(result).toBeNull()
    })

    test('caches successful result', async () => {
      let fetchCount = 0
      setMockFetch((url) => {
        fetchCount++
        if (url.includes('/customFields')) {
          return Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  $type: 'StateProjectCustomField',
                  field: { name: 'State' },
                  bundle: { id: 'bundle-123' },
                },
              ]),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'bundle-123',
              aggregated: { project: [{ id: 'proj-1' }] },
            }),
            { status: 200 },
          ),
        )
      })

      await resolveStateBundle(config, 'proj-1')
      await resolveStateBundle(config, 'proj-1')

      expect(fetchCount).toBe(2)
    })

    test('determines bundle is not shared when single project', async () => {
      let callCount = 0
      setMockFetch(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  $type: 'StateProjectCustomField',
                  field: { name: 'State' },
                  bundle: { id: 'bundle-456' },
                },
              ]),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'bundle-456',
              aggregated: { project: [{ id: 'proj-1' }] },
            }),
            { status: 200 },
          ),
        )
      })

      const result = await resolveStateBundle(config, 'proj-1')

      expect(result).toEqual({ bundleId: 'bundle-456', isShared: false })
    })

    test('caches failures with shorter TTL', async () => {
      let fetchCount = 0
      setMockFetch(() => {
        fetchCount++
        return Promise.resolve(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }))
      })

      await resolveStateBundle(config, 'proj-1')
      await resolveStateBundle(config, 'proj-1')

      expect(fetchCount).toBe(1)
    })
  })

  describe('TTL expiration', () => {
    test('success cache expires after TTL', async () => {
      const originalDateNow = Date.now
      let currentTime = 1000000
      Date.now = (): number => currentTime

      let fetchCount = 0
      setMockFetch((url) => {
        fetchCount++
        if (url.includes('/customFields')) {
          return Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  $type: 'StateProjectCustomField',
                  field: { name: 'State' },
                  bundle: { id: 'bundle-123' },
                },
              ]),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'bundle-123',
              aggregated: { project: [{ id: 'proj-1' }] },
            }),
            { status: 200 },
          ),
        )
      })

      await resolveStateBundle(config, 'proj-1')
      expect(fetchCount).toBe(2)

      await resolveStateBundle(config, 'proj-1')
      expect(fetchCount).toBe(2)

      currentTime += 5 * 60 * 1000
      await resolveStateBundle(config, 'proj-1')
      expect(fetchCount).toBe(4)

      Date.now = originalDateNow
    })

    test('failure cache expires after TTL', async () => {
      const originalDateNow = Date.now
      let currentTime = 1000000
      Date.now = (): number => currentTime

      let fetchCount = 0
      setMockFetch(() => {
        fetchCount++
        return Promise.resolve(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }))
      })

      await resolveStateBundle(config, 'proj-1')
      expect(fetchCount).toBe(1)

      await resolveStateBundle(config, 'proj-1')
      expect(fetchCount).toBe(1)

      currentTime += 30 * 1000
      await resolveStateBundle(config, 'proj-1')
      expect(fetchCount).toBe(2)

      Date.now = originalDateNow
    })
  })

  describe('clearBundleCache', () => {
    test('clears all cached entries', async () => {
      let fetchCount = 0
      setMockFetch((url) => {
        fetchCount++
        if (url.includes('/customFields')) {
          return Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  $type: 'StateProjectCustomField',
                  field: { name: 'State' },
                  bundle: { id: 'bundle-789' },
                },
              ]),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'bundle-789',
              aggregated: { project: [{ id: 'proj-1' }] },
            }),
            { status: 200 },
          ),
        )
      })

      await resolveStateBundle(config, 'proj-1')
      clearBundleCache()
      await resolveStateBundle(config, 'proj-1')

      expect(fetchCount).toBe(4)
    })
  })

  describe('multi-instance isolation', () => {
    test('does not share cache between different YouTrack instances', async () => {
      const configA = { baseUrl: 'https://company-a.youtrack.cloud', token: 'token-a' }
      const configB = { baseUrl: 'https://company-b.youtrack.cloud', token: 'token-b' }

      let fetchCountA = 0
      let fetchCountB = 0

      setMockFetch((url) => {
        if (url.includes('company-a')) {
          fetchCountA++
          if (url.includes('/customFields')) {
            return Promise.resolve(
              new Response(
                JSON.stringify([
                  {
                    $type: 'StateProjectCustomField',
                    field: { name: 'State' },
                    bundle: { id: 'bundle-from-a' },
                  },
                ]),
                { status: 200 },
              ),
            )
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'bundle-from-a',
                aggregated: { project: [{ id: 'proj-1' }] },
              }),
              { status: 200 },
            ),
          )
        }

        if (url.includes('company-b')) {
          fetchCountB++
          if (url.includes('/customFields')) {
            return Promise.resolve(
              new Response(
                JSON.stringify([
                  {
                    $type: 'StateProjectCustomField',
                    field: { name: 'State' },
                    bundle: { id: 'bundle-from-b' },
                  },
                ]),
                { status: 200 },
              ),
            )
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'bundle-from-b',
                aggregated: { project: [{ id: 'proj-1' }] },
              }),
              { status: 200 },
            ),
          )
        }

        return Promise.resolve(new Response(JSON.stringify({ error: 'Unknown URL' }), { status: 404 }))
      })

      const resultA = await resolveStateBundle(configA, 'proj-1')
      const resultB = await resolveStateBundle(configB, 'proj-1')

      // Each instance should have fetched their own bundle
      expect(resultA).toEqual({ bundleId: 'bundle-from-a', isShared: false })
      expect(resultB).toEqual({ bundleId: 'bundle-from-b', isShared: false })
      expect(fetchCountA).toBe(2)
      expect(fetchCountB).toBe(2)
    })

    test('caches are isolated per YouTrack instance', async () => {
      const configA = { baseUrl: 'https://company-a.youtrack.cloud', token: 'token-a' }
      const configB = { baseUrl: 'https://company-b.youtrack.cloud', token: 'token-b' }

      let fetchCountA = 0
      let fetchCountB = 0

      setMockFetch((url) => {
        if (url.includes('company-a')) {
          fetchCountA++
          if (url.includes('/customFields')) {
            return Promise.resolve(
              new Response(
                JSON.stringify([
                  {
                    $type: 'StateProjectCustomField',
                    field: { name: 'State' },
                    bundle: { id: 'bundle-a' },
                  },
                ]),
                { status: 200 },
              ),
            )
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'bundle-a',
                aggregated: { project: [{ id: 'shared-proj' }] },
              }),
              { status: 200 },
            ),
          )
        }

        if (url.includes('company-b')) {
          fetchCountB++
          if (url.includes('/customFields')) {
            return Promise.resolve(
              new Response(
                JSON.stringify([
                  {
                    $type: 'StateProjectCustomField',
                    field: { name: 'State' },
                    bundle: { id: 'bundle-b' },
                  },
                ]),
                { status: 200 },
              ),
            )
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'bundle-b',
                aggregated: { project: [{ id: 'shared-proj' }] },
              }),
              { status: 200 },
            ),
          )
        }

        return Promise.resolve(new Response(JSON.stringify({ error: 'Unknown URL' }), { status: 404 }))
      })

      // First call from instance A - should fetch
      await resolveStateBundle(configA, 'shared-proj')
      expect(fetchCountA).toBe(2)

      // Second call from instance A - should use cache (no new fetch)
      await resolveStateBundle(configA, 'shared-proj')
      expect(fetchCountA).toBe(2)

      // Call from instance B with same projectId - should fetch, not use A's cache
      await resolveStateBundle(configB, 'shared-proj')
      expect(fetchCountB).toBe(2)

      // Second call from instance B - should use cache
      await resolveStateBundle(configB, 'shared-proj')
      expect(fetchCountB).toBe(2)

      // Verify A's cache still works
      await resolveStateBundle(configA, 'shared-proj')
      expect(fetchCountA).toBe(2)
    })
  })
})
