import { describe, expect, test } from 'bun:test'

describe('dashboard-ui', () => {
  test('window.dashboard initialization check exists in source', async () => {
    // Read the source file directly to verify the fix is present
    const file = Bun.file('src/debug/dashboard-ui/index.ts')
    const content = await file.text()

    // Should check for and initialize window.dashboard
    expect(content).toContain("typeof window.dashboard === 'undefined'")
    expect(content).toContain('const dashboard: DashboardAPI = {')
  })

  test('imports DashboardAPI type from dashboard-types', async () => {
    const file = Bun.file('src/debug/dashboard-ui/index.ts')
    const content = await file.text()

    // Should import DashboardAPI type from dashboard-types
    expect(content).toContain('DashboardAPI')
    expect(content).toContain("from '../dashboard-types.js'")
  })
})
