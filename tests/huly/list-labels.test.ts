import { describe, expect, test, beforeEach } from 'bun:test'

import { setupListLabelsMock } from '../../src/huly/__mocks__/list-labels.js'
import { listLabels } from '../../src/huly/list-labels.js'

const mockUserId = 12345

describe('listLabels with Huly', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('returns labels for workspace', async () => {
    setupListLabelsMock()
    const result = await listLabels({
      userId: mockUserId,
    })

    expect(result).toHaveLength(3)
    expect(result[0]?.name).toBe('Bug')
    expect(result[1]?.name).toBe('Feature')
    expect(result[2]?.name).toBe('Documentation')
  })
})
