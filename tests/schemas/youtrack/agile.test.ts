// tests/providers/youtrack/schemas/agile.test.ts
import { describe, expect, test } from 'bun:test'

import { AgileBoardSchema, AgileColumnSchema, ListAgileBoardsRequestSchema } from '../../../schemas/youtrack/agile.js'

describe('Agile board schemas', () => {
  test('AgileBoardSchema validates board', () => {
    const valid = {
      id: '0-0',
      $type: 'Agile',
      name: 'Sprint Board',
      projects: [{ id: '0-0', $type: 'Project' }],
    }
    const result = AgileBoardSchema.parse(valid)
    expect(result.name).toBe('Sprint Board')
  })

  test('AgileColumnSchema validates column', () => {
    const valid = {
      id: '0-0',
      $type: 'AgileColumn',
      name: 'In Progress',
      ordinal: 1,
    }
    const result = AgileColumnSchema.parse(valid)
    expect(result.name).toBe('In Progress')
  })

  test('ListAgileBoardsRequestSchema validates query', () => {
    const valid = {
      fields: 'id,name,projects',
    }
    const result = ListAgileBoardsRequestSchema.parse(valid)
    expect(result.fields).toBe('id,name,projects')
  })
})
