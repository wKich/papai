import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import { applyYouTrackCommand } from '../../../../src/providers/youtrack/operations/commands.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

let fetchMock: ReturnType<typeof mock<(url: string, init: RequestInit) => Promise<Response>>> | undefined

const config: YouTrackConfig = { baseUrl: 'https://test.youtrack.cloud', token: 'test-token' }

const installFetchMock = (handler: () => Promise<Response>): void => {
  const mocked = mock<(url: string, init: RequestInit) => Promise<Response>>(handler)
  fetchMock = mocked
  setMockFetch((url: string, init: RequestInit) => mocked(url, init))
}

const FetchCallSchema = z.tuple([
  z.string(),
  z.looseObject({ method: z.string().optional(), body: z.string().optional() }),
])

const FetchBodySchema = z.record(z.string(), z.unknown())

const getFetchBody = (): Record<string, unknown> => {
  const parsed = FetchCallSchema.parse(fetchMock?.mock.calls[0])
  return FetchBodySchema.parse(JSON.parse(parsed[1].body ?? '{}'))
}

beforeEach(() => {
  mockLogger()
})

afterEach(() => {
  restoreFetch()
  fetchMock = undefined
})

describe('applyYouTrackCommand', () => {
  test('posts a command using readable issue IDs', async () => {
    installFetchMock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ query: 'for me', issues: [{ id: '2-15', idReadable: 'TEST-1' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const result = await applyYouTrackCommand(config, {
      query: 'for me',
      taskIds: ['TEST-1'],
      comment: 'Assigning to myself',
      silent: true,
    })

    expect(result).toEqual({ query: 'for me', taskIds: ['TEST-1'], comment: 'Assigning to myself', silent: true })
    expect(getFetchBody()).toEqual({
      query: 'for me',
      issues: [{ idReadable: 'TEST-1' }],
      comment: 'Assigning to myself',
      silent: true,
    })
  })
})
