import { describe, expect, test } from 'bun:test'

import { setupCreateProjectMock } from '../../src/linear/__mocks__/create-project.js'
import { createProject } from '../../src/linear/create-project.js'

const mockUserId = 12345

describe('createProject', () => {
  test('creates project with name and identifier', async () => {
    setupCreateProjectMock()
    const result = await createProject({
      userId: mockUserId,
      name: 'Test Project',
      identifier: 'TEST',
    })

    expect(result).toBeDefined()
    expect(result.id).toBeDefined()
    expect(result.name).toBe('Test Project')
    expect(result.identifier).toBe('TEST')
    expect(result.url).toBeDefined()
  })

  test('creates project with description', async () => {
    setupCreateProjectMock()
    const result = await createProject({
      userId: mockUserId,
      name: 'Test Project',
      identifier: 'TEST',
      description: 'A detailed description',
    })

    expect(result).toBeDefined()
    expect(result.id).toBeDefined()
  })
})
