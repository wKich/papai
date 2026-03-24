import { describe, expect, test } from 'bun:test'

import { buildImportGraph } from '../../../scripts/check-mock-pollution/scanner.js'

describe('buildImportGraph', () => {
  test('builds graph from test file importing source file', () => {
    const files = [
      {
        path: '/tests/poller.test.ts',
        imports: ['/src/poller.ts'],
      },
      {
        path: '/src/poller.ts',
        imports: ['/src/background-events.ts'],
      },
      {
        path: '/src/background-events.ts',
        imports: ['/src/db/drizzle.ts'],
      },
    ]

    const graph = buildImportGraph(files)

    // Graph should map module -> files that import it
    expect(graph.get('/src/poller.ts')).toContain('/tests/poller.test.ts')
    expect(graph.get('/src/background-events.ts')).toContain('/src/poller.ts')
    expect(graph.get('/src/db/drizzle.ts')).toContain('/src/background-events.ts')
  })

  test('handles unresolved imports gracefully', () => {
    const files = [
      {
        path: '/tests/test.ts',
        imports: ['external-package'],
      },
    ]

    const graph = buildImportGraph(files)

    // External packages shouldn't be in graph
    expect(graph.has('external-package')).toBe(false)
  })
})
