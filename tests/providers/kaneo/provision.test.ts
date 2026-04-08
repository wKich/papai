import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { _userCaches } from '../../../src/cache.js'
import { maybeProvisionKaneo, provisionKaneoUser } from '../../../src/providers/kaneo/provision.js'
import { mockLogger, restoreFetch, setMockFetch, setupTestDb } from '../../utils/test-helpers.js'

function parseBody(body: unknown): unknown {
  if (typeof body === 'string') {
    return JSON.parse(body) as unknown
  }
  return {}
}

describe('provisionKaneoUser - unique email generation', () => {
  beforeEach(() => {
    mockLogger()
    // Set required environment variable
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.test'
  })

  test('generates unique email with random suffix', async () => {
    const capturedEmails: string[] = []
    const capturedSlugs: string[] = []

    setMockFetch((url: string, init?: RequestInit) => {
      if (url.includes('/sign-up')) {
        const body = parseBody(init?.body)
        if (typeof body === 'object' && body !== null && 'email' in body && typeof body.email === 'string') {
          capturedEmails.push(body.email)
        }

        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 'user-123' }, token: 'session-token' }), {
            status: 200,
            headers: { 'Set-Cookie': 'better-auth.session_token=abc123; Path=/; HttpOnly' },
          }),
        )
      }

      if (url.includes('/organization/create')) {
        const body = parseBody(init?.body)
        let slug = 'test-slug'
        if (typeof body === 'object' && body !== null && 'slug' in body && typeof body.slug === 'string') {
          capturedSlugs.push(body.slug)
          slug = body.slug
        }

        return Promise.resolve(new Response(JSON.stringify({ id: 'ws-123', slug }), { status: 200 }))
      }

      if (url.includes('/api-key/create')) {
        return Promise.resolve(new Response(JSON.stringify({ key: 'api-key-123' }), { status: 200 }))
      }

      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    })

    // Provision user twice with same ID
    await provisionKaneoUser('https://kaneo.test', 'https://kaneo.test', '999', null)
    await provisionKaneoUser('https://kaneo.test', 'https://kaneo.test', '999', null)

    // Should have captured two different emails
    expect(capturedEmails).toHaveLength(2)
    expect(capturedEmails[0]).not.toBe(capturedEmails[1])

    // Both should contain the user ID
    expect(capturedEmails[0]).toContain('999')
    expect(capturedEmails[1]).toContain('999')

    // Both should end with @pap.ai
    expect(capturedEmails[0]).toMatch(/999-[a-z0-9]{8}@pap\.ai$/i)
    expect(capturedEmails[1]).toMatch(/999-[a-z0-9]{8}@pap\.ai$/i)

    // Should have captured two different slugs
    expect(capturedSlugs).toHaveLength(2)
    expect(capturedSlugs[0]).not.toBe(capturedSlugs[1])
  })

  test('generates email with username when provided', async () => {
    let capturedEmail = ''

    setMockFetch((url: string, init?: RequestInit) => {
      if (url.includes('/sign-up')) {
        const body = parseBody(init?.body)
        if (typeof body === 'object' && body !== null && 'email' in body && typeof body.email === 'string') {
          capturedEmail = body.email
        }

        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 'user-123' }, token: 'session-token' }), {
            status: 200,
            headers: { 'Set-Cookie': 'better-auth.session_token=abc123; Path=/; HttpOnly' },
          }),
        )
      }

      if (url.includes('/organization/create')) {
        return Promise.resolve(new Response(JSON.stringify({ id: 'ws-123', slug: 'test-ws' }), { status: 200 }))
      }

      if (url.includes('/api-key/create')) {
        return Promise.resolve(new Response(JSON.stringify({ key: 'api-key-123' }), { status: 200 }))
      }

      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    })

    await provisionKaneoUser('https://kaneo.test', 'https://kaneo.test', '123', 'alice')

    expect(capturedEmail).toMatch(/alice-[a-z0-9]{8}@pap\.ai$/i)
  })

  test('successful provisioning returns workspace and credentials', async () => {
    setMockFetch((url: string) => {
      if (url.includes('/sign-up')) {
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 'user-123' }, token: 'session-token' }), {
            status: 200,
            headers: { 'Set-Cookie': 'better-auth.session_token=abc123; Path=/; HttpOnly' },
          }),
        )
      }

      if (url.includes('/organization/create')) {
        return Promise.resolve(new Response(JSON.stringify({ id: 'ws-abc', slug: 'papai-999' }), { status: 200 }))
      }

      if (url.includes('/api-key/create')) {
        return Promise.resolve(new Response(JSON.stringify({ key: 'test-api-key' }), { status: 200 }))
      }

      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    })

    const result = await provisionKaneoUser('https://kaneo.test', 'https://kaneo.test', '999', null)

    expect(result.workspaceId).toBe('ws-abc')
    expect(result.kaneoKey).toBe('test-api-key')
    expect(result.email).toMatch(/999-[a-z0-9]{8}@pap\.ai$/i)
  })
})

describe('maybeProvisionKaneo', () => {
  let textCalls: string[] = []

  const mockReply = {
    text: (content: string): Promise<void> => {
      textCalls.push(content)
      return Promise.resolve()
    },
    formatted: (): Promise<void> => Promise.resolve(),
    file: (): Promise<void> => Promise.resolve(),
    typing: (): void => {},
    buttons: (): Promise<void> => Promise.resolve(),
  }

  const originalTaskProvider = process.env['TASK_PROVIDER']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    _userCaches.clear()
    textCalls = []
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.test'
  })

  afterEach(() => {
    restoreFetch()
    if (originalTaskProvider === undefined) {
      delete process.env['TASK_PROVIDER']
    } else {
      process.env['TASK_PROVIDER'] = originalTaskProvider
    }
  })

  test('skips auto-provisioning when TASK_PROVIDER is youtrack', async () => {
    process.env['TASK_PROVIDER'] = 'youtrack'

    await maybeProvisionKaneo(mockReply, 'user-1', 'testuser')

    // Should not send any reply since we skip early
    expect(textCalls).toHaveLength(0)
  })

  test('proceeds with auto-provisioning when TASK_PROVIDER is kaneo', async () => {
    // Ensure fresh user that doesn't have workspace configured
    const uniqueUserId = `kaneo-test-${Date.now()}`
    process.env['TASK_PROVIDER'] = 'kaneo'

    setMockFetch((url: string) => {
      if (url.includes('/sign-up')) {
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 'user-123' }, token: 'session-token' }), {
            status: 200,
            headers: { 'Set-Cookie': 'better-auth.session_token=abc123; Path=/; HttpOnly' },
          }),
        )
      }

      if (url.includes('/organization/create')) {
        return Promise.resolve(new Response(JSON.stringify({ id: 'ws-123', slug: 'test-ws' }), { status: 200 }))
      }

      if (url.includes('/api-key/create')) {
        return Promise.resolve(new Response(JSON.stringify({ key: 'api-key-123' }), { status: 200 }))
      }

      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    })

    await maybeProvisionKaneo(mockReply, uniqueUserId, 'testuser')

    // Should send welcome message with account details
    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toContain('Your Kaneo account has been created')
  })

  test('proceeds with auto-provisioning when TASK_PROVIDER is not set (defaults to kaneo)', async () => {
    const uniqueUserId = `kaneo-default-${Date.now()}`
    delete process.env['TASK_PROVIDER']

    setMockFetch((url: string) => {
      if (url.includes('/sign-up')) {
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 'user-123' }, token: 'session-token' }), {
            status: 200,
            headers: { 'Set-Cookie': 'better-auth.session_token=abc123; Path=/; HttpOnly' },
          }),
        )
      }

      if (url.includes('/organization/create')) {
        return Promise.resolve(new Response(JSON.stringify({ id: 'ws-123', slug: 'test-ws' }), { status: 200 }))
      }

      if (url.includes('/api-key/create')) {
        return Promise.resolve(new Response(JSON.stringify({ key: 'api-key-123' }), { status: 200 }))
      }

      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    })

    await maybeProvisionKaneo(mockReply, uniqueUserId, 'testuser')

    // Should send welcome message with account details
    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toContain('Your Kaneo account has been created')
  })
})
