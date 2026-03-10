import { logger } from '../logger.js'

const log = logger.child({ scope: 'kaneo:client' })

export type KaneoConfig = {
  apiKey: string
  baseUrl: string
}

export class KaneoApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody: unknown,
  ) {
    super(message)
    this.name = 'KaneoApiError'
  }
}

export async function kaneoFetch<T>(
  config: KaneoConfig,
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${config.baseUrl}/api${path}`)
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
  }

  log.debug({ method, path, hasBody: body !== undefined }, 'Kaneo API request')

  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    let responseBody: unknown
    try {
      responseBody = await response.json()
    } catch {
      responseBody = await response.text().catch(() => 'Unable to read response body')
    }
    log.error({ method, path, statusCode: response.status, responseBody }, 'Kaneo API error')
    throw new KaneoApiError(`Kaneo API ${method} ${path} returned ${response.status}`, response.status, responseBody)
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- response.json() returns unknown, generic cast is intentional
  const data: T = (await response.json()) as T
  log.debug({ method, path, statusCode: response.status }, 'Kaneo API response')
  return data
}
