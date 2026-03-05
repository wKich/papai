import { describe, expect, test } from 'bun:test'

import { setupListProjectsEmptyMock } from './__mocks__/list-projects-empty.js'
import { setupListProjectsMock } from './__mocks__/list-projects.js'
import { listProjects } from './list-projects.js'

const mockApiKey = 'test-api-key'

describe('listProjects with projects', () => {
  test('returns teams and projects', async () => {
    setupListProjectsMock()
    const results = await listProjects({ apiKey: mockApiKey })
    expect(results).toHaveLength(1)
    expect(results[0]?.teamName).toBe('Engineering')
    expect(results[0]?.projects).toHaveLength(2)
  })
})

describe('listProjects empty team', () => {
  test('handles team without projects', async () => {
    setupListProjectsEmptyMock()
    const results = await listProjects({ apiKey: mockApiKey })
    expect(results[0]?.projects).toHaveLength(0)
  })
})
