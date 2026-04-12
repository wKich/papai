import type { LookupAddress } from 'node:dns'
import { lookup } from 'node:dns/promises'

import * as ipaddr from 'ipaddr.js'

import { type WebFetchError, webFetchError } from '../errors.js'
import { logger } from '../logger.js'
import type { SafeFetchResponse } from './types.js'

const log = logger.child({ scope: 'web:safe-fetch' })

const MAX_TEXT_BYTES = 2_000_000
const MAX_PDF_BYTES = 10_000_000
const MAX_REDIRECTS = 5
const TOTAL_TIMEOUT_MS = 30_000

const TEXT_CONTENT_TYPES = new Set(['text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown'])

class SafeFetchClassifiedError extends Error {
  readonly type = 'web-fetch' as const
  readonly code: WebFetchError['code']
  readonly status?: number

  constructor(
    message: string,
    public readonly appError: WebFetchError,
  ) {
    super(message)
    this.name = 'SafeFetchClassifiedError'
    this.code = appError.code
    if ('status' in appError && appError.status !== undefined) {
      this.status = appError.status
    }
  }
}

export interface SafeFetchDeps {
  fetch: typeof fetch
  assertPublicUrl: (url: URL) => Promise<void>
}

const defaultDeps: SafeFetchDeps = {
  fetch,
  assertPublicUrl,
}

function throwWebFetchError(appError: WebFetchError, message: string): never {
  throw new SafeFetchClassifiedError(message, appError)
}

function isBlockedAddress(address: string): boolean {
  const range = ipaddr.parse(address).range()
  return (
    range === 'loopback' ||
    range === 'private' ||
    range === 'linkLocal' ||
    range === 'uniqueLocal' ||
    range === 'carrierGradeNat' ||
    range === 'unspecified'
  )
}

export async function assertPublicUrl(url: URL): Promise<void> {
  if (hasBlockedUrlParts(url)) {
    throwWebFetchError(webFetchError.blockedHost(), 'Blocked non-public URL')
  }

  const addresses = await lookupPublicAddresses(url.hostname)
  if (addresses.length === 0) {
    throwWebFetchError(webFetchError.blockedHost(), 'Blocked non-public host')
  }

  try {
    if (addresses.some((address) => isBlockedAddress(address.address))) {
      throwWebFetchError(webFetchError.blockedHost(), 'Blocked non-public host')
    }
  } catch {
    throwWebFetchError(webFetchError.blockedHost(), 'Blocked non-public host')
  }
}

function hasBlockedUrlParts(url: URL): boolean {
  return (url.protocol !== 'http:' && url.protocol !== 'https:') || url.username.length > 0 || url.password.length > 0
}

async function lookupPublicAddresses(hostname: string): Promise<LookupAddress[]> {
  try {
    return await lookup(hostname, { all: true, verbatim: true })
  } catch {
    return throwWebFetchError(webFetchError.blockedHost(), 'Host lookup failed')
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (reader === undefined) {
    return new Uint8Array()
  }

  const chunks: Uint8Array[] = []
  const totalBytes = await readChunks(reader, maxBytes, chunks, 0)
  return concatenateChunks(chunks, totalBytes)
}

async function readChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
  chunks: Uint8Array[],
  totalBytes: number,
): Promise<number> {
  const { done, value } = await reader.read()
  if (done) {
    return totalBytes
  }

  if (value === undefined) {
    return readChunks(reader, maxBytes, chunks, totalBytes)
  }

  const nextTotal = totalBytes + value.byteLength
  if (nextTotal > maxBytes) {
    throwWebFetchError(webFetchError.tooLarge(), 'Response body exceeded size limit')
  }

  chunks.push(value)
  return readChunks(reader, maxBytes, chunks, nextTotal)
}

function concatenateChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function parseUrl(rawUrl: string): URL {
  try {
    return new URL(rawUrl)
  } catch {
    return throwWebFetchError(webFetchError.invalidUrl(), 'Invalid URL')
  }
}

function getRedirectCount(options?: { redirectCount?: number }): number {
  const redirectCount = options?.redirectCount ?? 0
  if (redirectCount > MAX_REDIRECTS) {
    throwWebFetchError(webFetchError.upstreamError(310), 'Too many redirects')
  }
  return redirectCount
}

function composeAbortSignal(options?: { abortSignal?: AbortSignal }): AbortSignal {
  return options?.abortSignal === undefined
    ? AbortSignal.timeout(TOTAL_TIMEOUT_MS)
    : AbortSignal.any([options.abortSignal, AbortSignal.timeout(TOTAL_TIMEOUT_MS)])
}

function getRequestHeaders(): HeadersInit {
  return {
    Accept: 'text/html, application/xhtml+xml, text/plain, text/markdown, application/pdf',
    'User-Agent': `papai-bot/${process.env['npm_package_version'] ?? 'dev'}`,
  }
}

function isRedirect(response: Response): boolean {
  return response.status >= 300 && response.status < 400
}

function resolveRedirectUrl(response: Response, url: URL): URL {
  const location = response.headers.get('location')
  if (location === null) {
    throwWebFetchError(webFetchError.upstreamError(response.status), 'Redirect response missing location header')
  }

  try {
    return new URL(location, url)
  } catch {
    return throwWebFetchError(webFetchError.upstreamError(response.status), 'Redirect location was invalid')
  }
}

function getAllowedContentType(response: Response): { contentType: string; maxBytes: number } {
  const contentType = (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim() ?? ''
  if (contentType === 'application/pdf') {
    return { contentType, maxBytes: MAX_PDF_BYTES }
  }
  if (TEXT_CONTENT_TYPES.has(contentType)) {
    return { contentType, maxBytes: MAX_TEXT_BYTES }
  }
  return throwWebFetchError(webFetchError.blockedContentType(), 'Blocked unsupported content type')
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function rethrowSafeFetchError(error: unknown): never {
  if (isAbortError(error)) {
    throwWebFetchError(webFetchError.timeout(), 'Web fetch timed out')
  }
  if (error instanceof SafeFetchClassifiedError) {
    throw error
  }
  throw error
}

export async function safeFetchContent(
  rawUrl: string,
  options?: { abortSignal?: AbortSignal; redirectCount?: number },
  deps: SafeFetchDeps = defaultDeps,
): Promise<SafeFetchResponse> {
  const url = parseUrl(rawUrl)
  const redirectCount = getRedirectCount(options)
  const abortSignal = composeAbortSignal(options)

  log.debug({ rawUrl, redirectCount }, 'safeFetchContent')
  await deps.assertPublicUrl(url)

  try {
    const response = await deps.fetch(url.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: abortSignal,
      headers: getRequestHeaders(),
    })

    if (isRedirect(response)) {
      const redirectUrl = resolveRedirectUrl(response, url)
      return await safeFetchContent(redirectUrl.toString(), { abortSignal, redirectCount: redirectCount + 1 }, deps)
    }

    if (!response.ok) {
      throwWebFetchError(webFetchError.upstreamError(response.status), 'Upstream returned a non-success status')
    }

    const { contentType, maxBytes } = getAllowedContentType(response)
    const body = await readBoundedBody(response, maxBytes)
    const finalUrl = response.url === '' ? url.toString() : response.url

    log.info({ url: rawUrl, finalUrl, contentType, bytes: body.byteLength }, 'Fetched web content safely')
    return { finalUrl, contentType, body }
  } catch (error) {
    return rethrowSafeFetchError(error)
  }
}
