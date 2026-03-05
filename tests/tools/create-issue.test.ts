import { describe, expect, test } from 'bun:test'

import { makeCreateIssueTool } from '../../src/tools/create-issue.js'

describe('makeCreateIssueTool', () => {
  const linearKey = 'test-key'
  const linearTeamId = 'team-123'

  test('returns tool with required properties', () => {
    const tool = makeCreateIssueTool(linearKey, linearTeamId)
    expect(tool).toHaveProperty('description')
    expect(tool).toHaveProperty('inputSchema')
    expect(tool).toHaveProperty('execute')
    expect(typeof tool.execute).toBe('function')
  })
})
