import { describe, expect, test } from 'bun:test'

import { findTransitiveImporters } from '../../../scripts/check-test-health/graph.js'

describe('findTransitiveImporters', () => {
  test('finds direct importers', () => {
    const importGraph = new Map([['/src/db/drizzle.ts', ['/src/config.ts', '/src/background-events.ts']]])

    const result = findTransitiveImporters('/src/db/drizzle.ts', importGraph)

    expect(result).toContain('/src/config.ts')
    expect(result).toContain('/src/background-events.ts')
  })

  test('finds transitive importers through chain', () => {
    const importGraph = new Map([
      ['/src/db/drizzle.ts', ['/src/background-events.ts']],
      ['/src/background-events.ts', ['/src/poller.ts']],
      ['/src/poller.ts', ['/tests/poller.test.ts']],
    ])

    const result = findTransitiveImporters('/src/db/drizzle.ts', importGraph)

    expect(result).toContain('/src/background-events.ts')
    expect(result).toContain('/src/poller.ts')
    expect(result).toContain('/tests/poller.test.ts')
  })

  test('handles cycles without infinite loop', () => {
    const importGraph = new Map([
      ['/src/a.ts', ['/src/b.ts']],
      ['/src/b.ts', ['/src/c.ts']],
      // cycle: c → a
      ['/src/c.ts', ['/src/a.ts']],
    ])

    const result = findTransitiveImporters('/src/a.ts', importGraph)

    expect(result).toContain('/src/b.ts')
    expect(result).toContain('/src/c.ts')
    // no duplicates from cycle
    expect(result).toHaveLength(2)
  })

  test('returns empty array for module with no importers', () => {
    const importGraph = new Map([['/src/db/drizzle.ts', []]])

    const result = findTransitiveImporters('/src/db/drizzle.ts', importGraph)

    expect(result).toEqual([])
  })
})
