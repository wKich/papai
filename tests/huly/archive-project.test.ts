import { describe, expect, test } from 'bun:test'

import { setupArchiveProjectMock } from '../../src/huly/__mocks__/archive-project.js'
import { archiveProject } from '../../src/huly/archive-project.js'

const mockUserId = 12345

describe('archiveProject', () => {
  test('archives project successfully', async () => {
    setupArchiveProjectMock()
    const result = await archiveProject({
      userId: mockUserId,
      projectId: 'project-123',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('project-123')
    expect(result.success).toBe(true)
  })
})
