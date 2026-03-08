import { describe, it, expect } from 'bun:test'

import { mapLinearIssueToHuly, mapLinearPriorityToHuly } from '../../src/migration/issue-mapper.js'
import type { LinearIssue } from '../../src/migration/linear-client.js'

describe('Issue Mapper', () => {
  const mockLinearIssue: LinearIssue = {
    id: 'linear-123',
    identifier: 'TEAM-42',
    title: 'Test Issue',
    description: 'Test description',
    state: { name: 'In Progress', type: 'started' },
    priority: 2,
    labels: [{ name: 'bug' }],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
  }

  it('should map priority 0 to no priority', () => {
    expect(mapLinearPriorityToHuly(0)).toBeUndefined()
  })

  it('should map priority 1 to urgent', () => {
    expect(mapLinearPriorityToHuly(1)).toBe('urgent')
  })

  it('should map priority 2 to high', () => {
    expect(mapLinearPriorityToHuly(2)).toBe('high')
  })

  it('should map priority 3 to medium', () => {
    expect(mapLinearPriorityToHuly(3)).toBe('medium')
  })

  it('should map priority 4 to low', () => {
    expect(mapLinearPriorityToHuly(4)).toBe('low')
  })

  it('should map Linear issue to Huly format', () => {
    const result = mapLinearIssueToHuly(mockLinearIssue, 'project-123')
    expect(result.title).toBe('Test Issue')
    expect(result.description).toBe('Test description')
    expect(result.project).toBe('project-123')
    expect(result.priority).toBe('high')
    expect(result.labels).toEqual(['bug'])
  })
})
