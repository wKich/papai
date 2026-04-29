import { describe, expect, it } from 'bun:test'

import { z } from 'zod'

import { formatToolSchema, toJsonSchemaObject } from '../../src/tools/tool-schema-format.js'

describe('tool-schema-format', () => {
  it('converts a Zod object schema to JSON schema metadata', () => {
    const schema = z.object({
      taskId: z.string().describe('Task identifier'),
      priority: z.enum(['low', 'high']).optional().describe('Priority value'),
    })

    const json = toJsonSchemaObject(schema)

    expect(json?.['type']).toBe('object')
    expect(json?.['properties']).toBeObject()
    const properties = json?.['properties']
    expect(properties).toBeObject()
    expect(Object.prototype.hasOwnProperty.call(properties, 'taskId')).toBeTrue()
  })

  it('formats required, optional, descriptions, and enum values', () => {
    const schema = z.object({
      taskId: z.string().describe('Task identifier'),
      priority: z.enum(['low', 'high']).optional().describe('Priority value'),
    })

    expect(formatToolSchema(schema)).toBe(
      ['  taskId (string) *required* - Task identifier', '  priority (enum: "low", "high") - Priority value'].join(
        '\n',
      ),
    )
  })

  it('formats JSON schema objects directly', () => {
    const schema = {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number' },
      },
      required: ['query'],
    }

    expect(formatToolSchema(schema)).toBe(['  query (string) *required* - Search query', '  limit (number)'].join('\n'))
  })

  it('formats empty object schemas as no parameters', () => {
    expect(formatToolSchema(z.object({}))).toBe('  (no parameters)')
  })

  it('returns no schema for unsupported schema values', () => {
    expect(toJsonSchemaObject('not-a-schema')).toBeNull()
    expect(formatToolSchema('not-a-schema')).toBe('  (no schema)')
  })
})
