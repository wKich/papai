import { describe, expect, test } from 'bun:test'

import { normalizeWebUrl } from '../../src/web/url-normalize.js'

describe('normalizeWebUrl', () => {
  test('lowercases the hostname, strips tracking params and fragment, and sorts query params', () => {
    expect(normalizeWebUrl('HTTPS://Example.com/path?b=2&utm_source=x&a=1#frag')).toBe(
      'https://example.com/path?a=1&b=2',
    )
  })

  test('sorts remaining query params by key', () => {
    expect(normalizeWebUrl('https://example.com/article?topic=llm&page=2')).toBe(
      'https://example.com/article?page=2&topic=llm',
    )
  })
})
