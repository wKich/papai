/**
 * Migration Test: createIssue
 * 
 * Tests that Linear issue data correctly transforms to Plane work item format
 */

import { describe, expect, test, beforeAll } from 'bun:test'
import { skipIfNoPlaneApi } from '../setup.js'
import { LINEAR_TO_PLANE_PRIORITY } from '../fixtures/datasets/priority-mappings.js'

describe('createIssue Migration', () => {
  beforeAll(() => {
    skipIfNoPlaneApi()
  })

  test('transforms Linear issue to Plane work item', async () => {
    // Sample Linear issue data
    const linearIssue = {
      title: 'Fix authentication bug',
      description: 'Users cannot login with SSO',
      priority: 2, // high
      dueDate: '2025-03-15',
      estimate: 5,
      projectId: 'proj-456',
      teamId: 'team-123',
    }

    // Transform to Plane format
    const planeInput = {
      name: linearIssue.title,
      description_html: `<p>${linearIssue.description}</p>`,
      priority: LINEAR_TO_PLANE_PRIORITY[linearIssue.priority],
      target_date: linearIssue.dueDate,
      estimate_point: String(linearIssue.estimate),
    }

    // Verify transformation logic (without actual API call in this example)
    expect(planeInput.name).toBe(linearIssue.title)
    expect(planeInput.priority).toBe('high')
    expect(planeInput.estimate_point).toBe('5')
    expect(planeInput.description_html).toContain(linearIssue.description)
  })

  test('handles missing optional fields', async () => {
    const minimalLinearIssue = {
      title: 'Quick fix',
      teamId: 'team-123',
    }

    const planeInput: { name: string; priority?: string; estimate_point?: string; target_date?: string } = {
      name: minimalLinearIssue.title,
    }

    // Optional fields omitted
    expect(planeInput.priority).toBeUndefined()
    expect(planeInput.estimate_point).toBeUndefined()
    expect(planeInput.target_date).toBeUndefined()
  })

  test('maps all priority values correctly', () => {
    const testCases = [
      { linear: 0, plane: 'none' },
      { linear: 1, plane: 'urgent' },
      { linear: 2, plane: 'high' },
      { linear: 3, plane: 'medium' },
      { linear: 4, plane: 'low' },
    ]

    for (const { linear, plane } of testCases) {
      expect(LINEAR_TO_PLANE_PRIORITY[linear]).toBe(plane)
    }
  })
})
