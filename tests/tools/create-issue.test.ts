import { describe, expect, test } from 'bun:test'

import { makeCreateIssueTool } from '../../src/tools/create-issue.js'

describe('makeCreateIssueTool', () => {
  test('returns tool with required properties', () => {
    const tool = makeCreateIssueTool(12345)
    expect(tool).toHaveProperty('description')
    expect(tool).toHaveProperty('inputSchema')
    expect(tool).toHaveProperty('execute')
    expect(typeof tool.execute).toBe('function')
  })
})
