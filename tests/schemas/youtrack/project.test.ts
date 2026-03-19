// tests/providers/youtrack/schemas/project.test.ts
import { describe, expect, test } from 'bun:test'

import {
  ProjectSchema,
  CreateProjectRequestSchema,
  ListProjectsRequestSchema,
} from '../../../src/providers/youtrack/schemas/project.js'

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

  test('CreateProjectRequestSchema validates request', () => {
    const valid = {
      name: 'New Project',
      shortName: 'NP',
    }
    const result = CreateProjectRequestSchema.parse(valid)
    expect(result.shortName).toBe('NP')
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

  test('ListProjectsRequestSchema validates with query', () => {
    const valid = {
      query: {
        fields: 'id,name,shortName',
      },
    }
    const result = ListProjectsRequestSchema.parse(valid)
    expect(result.query.fields).toBe('id,name,shortName')
  })
})
