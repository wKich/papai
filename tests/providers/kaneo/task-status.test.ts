import { afterEach, describe, expect, mock, test } from 'bun:test'

import { mockLogger } from '../../utils/test-helpers.js'

// Mock logger before importing modules that use it
mockLogger()

import { getUserMessage } from '../../../src/errors.js'
import { KaneoClassifiedError } from '../../../src/providers/kaneo/classify-error.js'
import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'
import { validateStatus } from '../../../src/providers/kaneo/task-status.js'
import { restoreFetch } from '../../test-helpers.js'

void mock.module('../../../src/providers/kaneo/list-columns.js', () => ({
  listColumns: mock(() =>
    Promise.resolve([
      { id: 'col-1', name: 'To Do', order: 0 },
      { id: 'col-2', name: 'In Progress', order: 1 },
      { id: 'col-3', name: 'Done', order: 2 },
    ]),
  ),
}))

describe('validateStatus', () => {
  const mockConfig: KaneoConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://test.kaneo.app',
  }

  afterEach(() => {
    restoreFetch()
  })

  describe('with valid status names', () => {
    test('resolves with slug for exact column name match', async () => {
      const result = await validateStatus(mockConfig, 'proj-1', 'To Do')
      expect(result).toBe('to-do')
    })

    test('resolves with slug for case-insensitive match', async () => {
      const result = await validateStatus(mockConfig, 'proj-1', 'to do')
      expect(result).toBe('to-do')
    })

    test('resolves with slug for hyphenated input', async () => {
      const result = await validateStatus(mockConfig, 'proj-1', 'in-progress')
      expect(result).toBe('in-progress')
    })
  })

  describe('with invalid status names', () => {
    test('throws KaneoClassifiedError with status-not-found code', async () => {
      let thrownError: unknown
      try {
        await validateStatus(mockConfig, 'proj-1', 'Review')
      } catch (error) {
        thrownError = error
      }
      expect(thrownError).toBeInstanceOf(KaneoClassifiedError)
      if (thrownError instanceof KaneoClassifiedError) {
        expect(thrownError.appError.code).toBe('status-not-found')
      }
    })

    test('error includes invalid status name', async () => {
      let thrownError: unknown
      try {
        await validateStatus(mockConfig, 'proj-1', 'InvalidStatus')
      } catch (error) {
        thrownError = error
      }
      expect(thrownError).toBeInstanceOf(Error)
      if (thrownError instanceof Error) {
        expect(thrownError.message).toContain('InvalidStatus')
      }
    })

    test('error includes available statuses in payload', async () => {
      let thrownError: unknown
      try {
        await validateStatus(mockConfig, 'proj-1', 'NonExistent')
      } catch (error) {
        thrownError = error
      }
      expect(thrownError).toBeInstanceOf(KaneoClassifiedError)
      if (thrownError instanceof KaneoClassifiedError) {
        const appError = thrownError.appError
        expect(appError.code).toBe('status-not-found')
        // Verify the error message contains the expected data
        const message = getUserMessage(appError)
        expect(message).toContain('NonExistent')
        expect(message).toContain('To Do')
        expect(message).toContain('In Progress')
        expect(message).toContain('Done')
      }
    })
  })

  describe('error message format', () => {
    test('provides user-friendly message via getUserMessage', async () => {
      let thrownError: unknown
      try {
        await validateStatus(mockConfig, 'proj-1', 'Review')
      } catch (error) {
        thrownError = error
      }
      expect(thrownError).toBeInstanceOf(KaneoClassifiedError)
      if (thrownError instanceof KaneoClassifiedError) {
        const message = getUserMessage(thrownError.appError)
        expect(message).toContain('Review')
        expect(message).toContain('To Do')
        expect(message).toContain('In Progress')
        expect(message).toContain('Done')
      }
    })
  })
})
