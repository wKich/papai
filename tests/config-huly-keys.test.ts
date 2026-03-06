import { describe, it, expect } from 'bun:test'

import { isConfigKey } from '../src/config.js'

describe('Huly config keys', () => {
  it('should include huly_email', () => {
    expect(isConfigKey('huly_email')).toBe(true)
  })

  it('should include huly_password', () => {
    expect(isConfigKey('huly_password')).toBe(true)
  })

  it('should NOT include linear_key', () => {
    expect(isConfigKey('linear_key')).toBe(false)
  })

  it('should NOT include linear_team_id', () => {
    expect(isConfigKey('linear_team_id')).toBe(false)
  })

  it('should still include openai_key', () => {
    expect(isConfigKey('openai_key')).toBe(true)
  })
})
