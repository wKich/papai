import { describe, expect, it } from 'bun:test'

import type { ToolMode, MakeToolsOptions } from '../../src/tools/types.js'

describe('types', () => {
  it('should export ToolMode type', () => {
    const normalMode: ToolMode = 'normal'
    const proactiveMode: ToolMode = 'proactive'

    expect(normalMode).toBe('normal')
    expect(proactiveMode).toBe('proactive')
  })

  it('should export MakeToolsOptions type', () => {
    const options: MakeToolsOptions = {
      storageContextId: 'user-123',
      mode: 'normal',
    }

    expect(options.storageContextId).toBe('user-123')
    expect(options.mode).toBe('normal')
  })

  it('should accept partial MakeToolsOptions', () => {
    const options: MakeToolsOptions = {}

    expect(options).toBeDefined()
  })
})
