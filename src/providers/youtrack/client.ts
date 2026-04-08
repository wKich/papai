import { logger } from '../../logger.js'

const log = logger.child({ scope: 'youtrack:client' })

export type YouTrackConfig = {
  baseUrl: string
  token: string
}

export class YouTrackApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body: unknown,
  ) {
    super(message)
    this.name = 'YouTrackApiError'
  }
}

/** Low-level fetch wrapper for the YouTrack REST API. */
export async function youtrackFetch(
  config: YouTrackConfig,
  method: string,
  path: string,
  options?: { body?: unknown; query?: Record<string, string> },
): Promise<unknown> {
  const url = new URL(path, config.baseUrl)
  if (options?.query !== undefined) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value)
    }
  }

  log.debug({ method, path, hasBody: options?.body !== undefined }, 'YouTrack API request')

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/json',
  }
  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  })

  if (!response.ok) {
    let errorBody: unknown
    try {
      errorBody = await response.json()
    } catch {
      errorBody = await response.text().catch(() => null)
    }
    const msg = `YouTrack API ${method} ${path} returned ${response.status}`
    log.error({ statusCode: response.status, path, errorBody }, msg)
    throw new YouTrackApiError(msg, response.status, errorBody)
  }

  if (response.status === 204) {
    return undefined
  }

  const data: unknown = await response.json()
  log.debug({ method, path }, 'YouTrack API response received')
  return data
}

/**
 * Multipart form-data upload for YouTrack attachments.
 * Uses repeated `upload` fields as required by the YouTrack API.
 */
export async function youtrackUpload(
  config: YouTrackConfig,
  path: string,
  file: { name: string; content: Uint8Array | Blob; mimeType?: string },
  query?: Record<string, string>,
): Promise<unknown> {
  const url = new URL(path, config.baseUrl)
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
  }

  log.debug({ path, fileName: file.name }, 'YouTrack upload request')
  const blob =
    file.content instanceof Blob
      ? file.content
      : new Blob([Buffer.from(file.content)], { type: file.mimeType ?? 'application/octet-stream' })
  const form = new FormData()
  form.append('upload', blob, file.name)

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/json',
    },
    body: form,
  })

  if (!response.ok) {
    let errorBody: unknown
    try {
      errorBody = await response.json()
    } catch {
      errorBody = await response.text().catch(() => null)
    }
    const msg = `YouTrack API POST ${path} returned ${response.status}`
    log.error({ statusCode: response.status, path, errorBody }, msg)
    throw new YouTrackApiError(msg, response.status, errorBody)
  }

  if (response.status === 204) {
    return undefined
  }

  const data: unknown = await response.json()
  log.debug({ path }, 'YouTrack upload response received')
  return data
}
