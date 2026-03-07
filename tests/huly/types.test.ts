import { describe, expect, it } from 'bun:test'

import type { HulyClient } from '../../src/huly/types.js'

describe('HulyClient type', () => {
  it('should be importable as a type', () => {
    const checkType = (_client: HulyClient): void => {
      // no-op
    }
    expect(typeof checkType).toBe('function')
  })
})
