import { type ZodType, z } from 'zod'

import { logger } from '../../logger.js'
import { KaneoApiError, KaneoValidationError } from './errors.js'

const log = logger.child({ scope: 'kaneo:client' })

// Schema for operations that return empty/unknown responses (DELETE, etc.)
export const EmptyResponseSchema = z.unknown()

export type KaneoConfig = {
  apiKey: string
  baseUrl: string
  /** Session cookie value (better-auth.session_token=...). When set, sent instead of Authorization: Bearer. */
  sessionCookie?: string
}

function buildUrl(config: KaneoConfig, path: string, query?: Record<string, string>): URL {
  const url = new URL(`${config.baseUrl}/api${path}`)
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
  }
  return url
}

async function fetchResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return response.text().catch(() => 'Unable to read response body')
  }
}

async function handleErrorResponse(response: Response, method: string, path: string): Promise<never> {
  const responseBody = await fetchResponseBody(response)
  log.error({ method, path, statusCode: response.status, responseBody }, 'Kaneo API error')
  throw new KaneoApiError(`Kaneo API ${method} ${path} returned ${response.status}`, response.status, responseBody)
}

function validateResponse<T>(
  rawData: unknown,
  schema: ZodType<T>,
  method: string,
  path: string,
  statusCode: number,
): T {
  const result = schema.safeParse(rawData)
  if (!result.success) {
    log.error({ method, path, error: result.error }, 'Kaneo API response validation failed')
    throw new KaneoValidationError(`Kaneo API ${method} ${path} returned invalid data`, result.error)
  }
  log.debug({ method, path, statusCode }, 'Kaneo API response validated')
  return result.data
}

export async function kaneoFetch<T>(
  config: KaneoConfig,
  method: string,
  path: string,
  body: unknown,
  query: Record<string, string> | undefined,
  schema: ZodType<T>,
): Promise<T> {
  const url = buildUrl(config, path, query)

  log.debug({ method, path, hasBody: body !== undefined }, 'Kaneo API request')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.sessionCookie === undefined) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  } else {
    headers['Cookie'] = config.sessionCookie
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    return handleErrorResponse(response, method, path)
  }

  const rawData: unknown = await response.json()

  return validateResponse(rawData, schema, method, path, response.status)
}

// Re-export schemas for backward compatibility
export { TaskSchema as KaneoTaskResponseSchema } from './schemas/createTask.js'
export { CreateProjectResponseSchema as KaneoProjectSchema } from './schemas/create-project.js'
export { GetProjectResponseSchema as KaneoProjectFullSchema } from './schemas/get-project.js'
export { CreateLabelResponseSchema as KaneoLabelSchema } from './schemas/createLabel.js'
export { ColumnCompatSchema as KaneoColumnSchema } from './schemas/api-compat.js'
export { GetActivitiesResponseSchema as KaneoActivityWithTypeSchema } from './schemas/getActivities.js'
