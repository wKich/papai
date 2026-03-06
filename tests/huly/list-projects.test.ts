import { describe, expect, test } from 'bun:test'

import { setupListProjectsMock } from '../../src/huly/__mocks__/list-projects.js'
import { listProjects } from '../../src/huly/list-projects.js'

const mockUserId = 12345

describe('listProjects', () => {
  test('returns projects', async () => {
    setupListProjectsMock()
    const results = await listProjects({ userId: mockUserId })
    expect(results).toHaveLength(1)
    expect(results[0]?.teamName).toBe('Projects')
    expect(results[0]?.projects).toHaveLength(2)
    expect(results[0]?.projects[0]?.name).toBe('Project A')
    expect(results[0]?.projects[0]?.identifier).toBe('PROJ-A')
  })

  test('handles empty project list', async () => {
    const { setupListProjectsEmptyMock } = await import('../../src/huly/__mocks__/list-projects-empty.js')
    setupListProjectsEmptyMock()
    const results = await listProjects({ userId: mockUserId })
    expect(results[0]?.projects).toHaveLength(0)
  })
})
