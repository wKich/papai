import { describe, expect, test } from 'bun:test'

import { fetchWithoutTimeout } from '../../src/utils/fetch.js'

describe('fetchWithoutTimeout', () => {
  test('exports fetchWithoutTimeout function', () => {
    expect(typeof fetchWithoutTimeout).toBe('function')
  })

  test('has preconnect method', () => {
    expect(typeof fetchWithoutTimeout.preconnect).toBe('function')
  })
})
