import { describe, expect, test } from 'bun:test'

import { setupUpdateProjectMock } from '../../src/linear/__mocks__/update-project.js'
import { HulyApiError } from '../../src/linear/classify-error.js'
import { updateProject } from '../../src/linear/update-project.js'

const mockUserId = 12345

describe('updateProject', () => {
  test('updates project successfully', async () => {
    setupUpdateProjectMock()
    const result = await updateProject({
      userId: mockUserId,
      projectId: 'project-123',
      name: 'Updated Project',
      description: 'New description',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('project-123')
    expect(result.name).toBe('Updated Project')
  })

  test('throws error when no fields provided', () => {
    setupUpdateProjectMock()
    expect(
      updateProject({
        userId: mockUserId,
        projectId: 'project-123',
      }),
    ).rejects.toThrow(HulyApiError)
  })

  describe('error handling', () => {
    test('throws HulyApiError when project not found', () => {
      setupUpdateProjectMock()
      expect(
        updateProject({
          userId: mockUserId,
          projectId: 'invalid-project',
          name: 'Updated Name',
        }),
      ).rejects.toThrow(HulyApiError)
    })

    test('throws HulyApiError with project-not-found code', async () => {
      setupUpdateProjectMock()
      let thrown = false
      try {
        await updateProject({
          userId: mockUserId,
          projectId: 'invalid-project',
          name: 'Updated Name',
        })
      } catch (error) {
        thrown = true
        expect(error).toBeInstanceOf(HulyApiError)
        if (error instanceof HulyApiError) {
          expect(error.appError.code).toBe('project-not-found')
        }
      }
      expect(thrown).toBe(true)
    })
  })
})
