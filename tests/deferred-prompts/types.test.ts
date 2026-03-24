import { describe, expect, test } from 'bun:test'

import { alertConditionSchema, CONDITION_FIELDS, FIELD_OPERATORS } from '../../src/deferred-prompts/types.js'

describe('alertConditionSchema', () => {
  describe('valid leaf conditions', () => {
    test('eq with string value', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.status',
        op: 'eq',
        value: 'done',
      })
      expect(result.success).toBe(true)
    })

    test('overdue without value', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.dueDate',
        op: 'overdue',
      })
      expect(result.success).toBe(true)
    })

    test('stale_days with numeric value', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.updatedAt',
        op: 'stale_days',
        value: 7,
      })
      expect(result.success).toBe(true)
    })

    test('changed_to operator', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.priority',
        op: 'changed_to',
        value: 'urgent',
      })
      expect(result.success).toBe(true)
    })

    test('contains operator for labels', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.labels',
        op: 'contains',
        value: 'bug',
      })
      expect(result.success).toBe(true)
    })

    test('neq operator for project', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.project',
        op: 'neq',
        value: 'archived-project',
      })
      expect(result.success).toBe(true)
    })
  })

  describe('valid combinator conditions', () => {
    test('and combinator', () => {
      const result = alertConditionSchema.safeParse({
        and: [
          { field: 'task.status', op: 'eq', value: 'in-progress' },
          { field: 'task.dueDate', op: 'overdue' },
        ],
      })
      expect(result.success).toBe(true)
    })

    test('or combinator', () => {
      const result = alertConditionSchema.safeParse({
        or: [
          { field: 'task.priority', op: 'eq', value: 'urgent' },
          { field: 'task.priority', op: 'eq', value: 'high' },
        ],
      })
      expect(result.success).toBe(true)
    })

    test('nested combinators', () => {
      const result = alertConditionSchema.safeParse({
        and: [
          {
            or: [
              { field: 'task.status', op: 'eq', value: 'todo' },
              { field: 'task.status', op: 'eq', value: 'in-progress' },
            ],
          },
          { field: 'task.dueDate', op: 'overdue' },
        ],
      })
      expect(result.success).toBe(true)
    })
  })

  describe('invalid conditions', () => {
    test('invalid field name', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.invalid',
        op: 'eq',
        value: 'test',
      })
      expect(result.success).toBe(false)
    })

    test('invalid operator for field', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.status',
        op: 'overdue',
        value: 'done',
      })
      expect(result.success).toBe(false)
    })

    test('empty and array', () => {
      const result = alertConditionSchema.safeParse({
        and: [],
      })
      expect(result.success).toBe(false)
    })

    test('empty or array', () => {
      const result = alertConditionSchema.safeParse({
        or: [],
      })
      expect(result.success).toBe(false)
    })

    test('gt operator invalid for labels field', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.labels',
        op: 'gt',
        value: '5',
      })
      expect(result.success).toBe(false)
    })

    test('contains operator invalid for status field', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.status',
        op: 'contains',
        value: 'done',
      })
      expect(result.success).toBe(false)
    })

    test('eq operator without value is rejected', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.status',
        op: 'eq',
      })
      expect(result.success).toBe(false)
    })

    test('changed_to operator without value is rejected', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.status',
        op: 'changed_to',
      })
      expect(result.success).toBe(false)
    })

    test('stale_days operator without value is rejected', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.updatedAt',
        op: 'stale_days',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('exports', () => {
    test('CONDITION_FIELDS contains all expected fields', () => {
      expect(CONDITION_FIELDS).toEqual([
        'task.status',
        'task.priority',
        'task.assignee',
        'task.dueDate',
        'task.updatedAt',
        'task.project',
        'task.labels',
      ])
    })

    test('FIELD_OPERATORS has entry for every field', () => {
      for (const field of CONDITION_FIELDS) {
        expect(FIELD_OPERATORS[field]).toBeDefined()
        expect(FIELD_OPERATORS[field].length).toBeGreaterThan(0)
      }
    })
  })
})
