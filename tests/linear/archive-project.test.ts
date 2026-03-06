import { describe, expect, test } from 'bun:test'

import { setupArchiveProjectMock } from '../../src/linear/__mocks__/archive-project.js'
import { archiveProject } from '../../src/linear/archive-project.js'

const mockApiKey = 'test-api-key'

describe('archiveProject', () => {
  test('archives project successfully', async () => {
    setupArchiveProjectMock()
    const result = await archiveProject({
      apiKey: mockApiKey,
      projectId: 'project-123',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('project-123')
    expect(result.success).toBe(true)
  })
})
