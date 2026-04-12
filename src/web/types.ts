export type WebFetchResult = {
  readonly url: string
  readonly title: string
  readonly summary: string
  readonly excerpt: string
  readonly truncated: boolean
  readonly contentType: string
  readonly source: 'cache' | 'fetch'
  readonly fetchedAt: number
}

export type RateLimitResult =
  | { readonly allowed: true; readonly remaining: number }
  | { readonly allowed: false; readonly remaining: 0; readonly retryAfterSec: number }

export type SafeFetchResponse = {
  readonly finalUrl: string
  readonly contentType: string
  readonly body: Uint8Array
}
