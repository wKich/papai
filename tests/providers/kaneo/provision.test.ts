import { beforeEach, describe, expect, test } from 'bun:test'

import { provisionKaneoUser } from '../../../src/providers/kaneo/provision.js'
import { setMockFetch } from '../../test-helpers.js'
import { mockLogger } from '../../utils/test-helpers.js'

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
