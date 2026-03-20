// tests/providers/youtrack/schemas/project.test.ts
import { describe, expect, test } from 'bun:test'

import { ProjectSchema } from '../../../../src/providers/youtrack/schemas/project.js'

describe('Project schemas', () => {
  test('ProjectSchema validates project', () => {
    const valid = {
      id: '0-0',
      $type: 'Project',
      name: 'My Project',
      shortName: 'MP',
      description: 'Description',
      archived: false,
    }
    const result = ProjectSchema.parse(valid)
    expect(result.shortName).toBe('MP')
  })

  test('ProjectSchema validates response (same shape as create response)', () => {
    const valid = {
      id: '0-0',
      $type: 'Project',
      name: 'New Project',
      shortName: 'NP',
    }
    expect(() => ProjectSchema.parse(valid)).not.toThrow()
  })
})
