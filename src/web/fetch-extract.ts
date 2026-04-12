import { webFetchError, type WebFetchError } from '../errors.js'
import { logger } from '../logger.js'
import { getCachedWebFetch, putCachedWebFetch } from './cache.js'
import { distillWebContent } from './distill.js'
import { extractHtmlContent } from './extract.js'
import { extractPdfText } from './pdf.js'
import { consumeWebFetchQuota } from './rate-limit.js'
import { safeFetchContent } from './safe-fetch.js'
import type { RateLimitResult, SafeFetchResponse, WebFetchResult } from './types.js'
import { normalizeWebUrl } from './url-normalize.js'

const log = logger.child({ scope: 'web:fetch-extract' })
const HTML_CONTENT_TYPES = new Set(['text/html', 'application/xhtml+xml'])

export const DEFAULT_TTL_MS = 15 * 60 * 1000

type FetchAndExtractInput = {
  storageContextId: string
  actorUserId?: string
  url: string
  goal?: string
  abortSignal?: AbortSignal
}

type ProcessedWebContent = {
  title: string
  content: string
}

class FetchAndExtractClassifiedError extends Error {
  readonly type = 'web-fetch' as const
  readonly code: WebFetchError['code']
  readonly status?: number

  constructor(
    message: string,
    public readonly appError: WebFetchError,
  ) {
    super(message)
    this.name = 'FetchAndExtractClassifiedError'
    this.code = appError.code
    if ('status' in appError && appError.status !== undefined) {
      this.status = appError.status
    }
  }
}

export interface FetchAndExtractDeps {
  consumeWebFetchQuota: (actorId: string, nowMs?: number) => RateLimitResult
  normalizeWebUrl: typeof normalizeWebUrl
  getCachedWebFetch: typeof getCachedWebFetch
  putCachedWebFetch: typeof putCachedWebFetch
  safeFetchContent: (url: string, options?: { abortSignal?: AbortSignal }) => Promise<SafeFetchResponse>
  extractHtmlContent: typeof extractHtmlContent
  extractPdfText: typeof extractPdfText
  distillWebContent: typeof distillWebContent
  now: () => number
}

const defaultDeps: FetchAndExtractDeps = {
  consumeWebFetchQuota,
  normalizeWebUrl,
  getCachedWebFetch,
  putCachedWebFetch,
  safeFetchContent,
  extractHtmlContent,
  extractPdfText,
  distillWebContent,
  now: () => Date.now(),
}

function throwWebFetchError(appError: WebFetchError, message: string): never {
  throw new FetchAndExtractClassifiedError(message, appError)
}

function getDefaultTitle(finalUrl: string): string {
  return new URL(finalUrl).hostname
}

function decodeBody(body: Uint8Array): string {
  return new TextDecoder().decode(body)
}

function normalizeUrl(rawUrl: string, deps: FetchAndExtractDeps): string {
  try {
    return deps.normalizeWebUrl(rawUrl)
  } catch {
    return throwWebFetchError(webFetchError.invalidUrl(), 'Invalid URL')
  }
}

function logFetchStart(input: FetchAndExtractInput, actorId: string): void {
  log.debug(
    {
      storageContextId: input.storageContextId,
      actorId,
      url: input.url,
      hasGoal: input.goal !== undefined,
    },
    'fetchAndExtract',
  )
}

function enforceQuota(actorId: string, requestStartedAt: number, deps: FetchAndExtractDeps): void {
  const quota = deps.consumeWebFetchQuota(actorId, requestStartedAt)
  if (!quota.allowed) {
    log.warn({ actorId, retryAfterSec: quota.retryAfterSec }, 'Web fetch quota exceeded')
    throwWebFetchError(webFetchError.rateLimited(), 'Web fetch quota exceeded')
  }
}

function getCachedResult(
  input: FetchAndExtractInput,
  actorId: string,
  normalizedUrl: string,
  requestStartedAt: number,
  deps: FetchAndExtractDeps,
): WebFetchResult | null {
  const cached = deps.getCachedWebFetch(normalizedUrl, requestStartedAt)
  if (cached !== null) {
    log.info(
      { actorId, storageContextId: input.storageContextId, normalizedUrl, finalUrl: cached.url },
      'Returned cached web fetch result',
    )
  }
  return cached
}

async function resolveProcessedContent(
  fetched: SafeFetchResponse,
  deps: FetchAndExtractDeps,
): Promise<ProcessedWebContent> {
  if (fetched.contentType === 'application/pdf') {
    return {
      title: getDefaultTitle(fetched.finalUrl),
      content: await deps.extractPdfText(fetched.body),
    }
  }

  const decodedBody = decodeBody(fetched.body)
  if (HTML_CONTENT_TYPES.has(fetched.contentType)) {
    return deps.extractHtmlContent(decodedBody, fetched.finalUrl)
  }

  return {
    title: getDefaultTitle(fetched.finalUrl),
    content: decodedBody,
  }
}

function buildResult(
  fetched: SafeFetchResponse,
  fetchedAt: number,
  processed: ProcessedWebContent,
  distilled: Awaited<ReturnType<FetchAndExtractDeps['distillWebContent']>>,
): WebFetchResult {
  return {
    url: fetched.finalUrl,
    title: processed.title,
    summary: distilled.summary,
    excerpt: distilled.excerpt,
    truncated: distilled.truncated,
    contentType: fetched.contentType,
    source: 'fetch',
    fetchedAt,
  }
}

export async function fetchAndExtract(
  input: FetchAndExtractInput,
  deps: FetchAndExtractDeps = defaultDeps,
): Promise<WebFetchResult> {
  const actorId = input.actorUserId ?? input.storageContextId
  const requestStartedAt = deps.now()

  logFetchStart(input, actorId)
  enforceQuota(actorId, requestStartedAt, deps)

  const normalizedUrl = normalizeUrl(input.url, deps)
  const cached = getCachedResult(input, actorId, normalizedUrl, requestStartedAt, deps)
  if (cached !== null) {
    return cached
  }

  const fetched = await deps.safeFetchContent(normalizedUrl, { abortSignal: input.abortSignal })
  const fetchedAt = deps.now()
  const processed = await resolveProcessedContent(fetched, deps)

  const distilled = await deps.distillWebContent({
    storageContextId: input.storageContextId,
    title: processed.title,
    content: processed.content,
    goal: input.goal,
  })

  const result = buildResult(fetched, fetchedAt, processed, distilled)
  deps.putCachedWebFetch(normalizedUrl, result, fetchedAt + DEFAULT_TTL_MS)

  log.info(
    {
      actorId,
      storageContextId: input.storageContextId,
      normalizedUrl,
      finalUrl: result.url,
      contentType: result.contentType,
      fetchedAt,
    },
    'Fetched and extracted web content',
  )

  return result
}
