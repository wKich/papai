import { type ZodType, z } from 'zod'

import { logger } from '../logger.js'
import { KaneoApiError, KaneoValidationError } from './errors.js'

const log = logger.child({ scope: 'kaneo:client' })

// Zod schemas for Kaneo API types
export const KaneoTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  number: z.number(),
  status: z.string(),
  priority: z.string(),
})

export const KaneoTaskWithProjectIdSchema = KaneoTaskSchema.extend({
  projectId: z.string().optional(),
})

export const KaneoTaskWithDetailsSchema = z.object({
  id: z.string(),
  title: z.string(),
  number: z.number(),
  status: z.string(),
  priority: z.string(),
  description: z.string(),
  dueDate: z.string().nullable(),
  projectId: z.string(),
  position: z.number(),
})

export const KaneoTaskResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  number: z.number(),
  status: z.string(),
  priority: z.string(),
  dueDate: z.string().nullable(),
  createdAt: z.string(),
  projectId: z.string(),
  userId: z.string().nullable(),
})

export const KaneoLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
})

export const KaneoProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
})

export const KaneoProjectFullSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  icon: z.string().nullable(),
  description: z.string().nullable(),
  isPublic: z.boolean().nullable(),
})

export const KaneoActivitySchema = z.object({
  id: z.string(),
  comment: z.string(),
  createdAt: z.string(),
})

export const KaneoActivityWithTypeSchema = z.object({
  id: z.string(),
  type: z.string(),
  content: z.string().nullish(),
  createdAt: z.string().nullish(),
})

// Schema for POST /activity/comment response (per API docs)
export const CreateCommentResponseSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  type: z.string(),
  createdAt: z.string(),
  userId: z.string().nullable(),
  content: z.string().nullable(),
  externalUserName: z.string().nullable(),
  externalUserAvatar: z.string().nullable(),
  externalSource: z.string().nullable(),
  externalUrl: z.string().nullable(),
})

export const KaneoColumnSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  isFinal: z.boolean(),
})

export const KaneoColumnSimpleSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export const KaneoWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
})

export const SearchResultSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      number: z.number(),
      status: z.string(),
      priority: z.string(),
    }),
  ),
})

// Schema for operations that return empty/unknown responses (DELETE, etc.)
export const EmptyResponseSchema = z.unknown()

export type KaneoConfig = {
  apiKey: string
  baseUrl: string
  /** Session cookie value (better-auth.session_token=...). When set, sent instead of Authorization: Bearer. */
  sessionCookie?: string
}

export { KaneoApiError, KaneoValidationError } from './errors.js'

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
