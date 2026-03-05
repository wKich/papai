import { describe, expect, test } from 'bun:test'

import { setupCreateProjectMock } from './__mocks__/create-project.js'
import { createProject } from './create-project.js'

const mockApiKey = 'test-api-key'

describe('createProject', () => {
  test('creates project with name only', async () => {
    setupCreateProjectMock()
    const result = await createProject({
      apiKey: mockApiKey,
      teamId: 'team-123',
      name: 'Test Project',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('project-123')
    expect(result.name).toBe('Test Project')
    expect(result.url).toBeDefined()
  })

  test('creates project with description', async () => {
    setupCreateProjectMock()
    const result = await createProject({
      apiKey: mockApiKey,
      teamId: 'team-123',
      name: 'Test Project',
      description: 'A detailed description',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('project-123')
  })
})
