import { describe, expect, test } from 'bun:test'

import { buildDescriptionWithRelations, parseRelationsFromDescription } from '../../src/providers/kaneo/frontmatter.js'
import { mapPriority } from '../../src/scripts/kaneo-import.js'

describe('mapPriority', () => {
  test('maps 0 to no-priority', () => {
    expect(mapPriority(0)).toBe('no-priority')
  })

  test('maps 1 to urgent', () => {
    expect(mapPriority(1)).toBe('urgent')
  })

  test('maps 2 to high', () => {
    expect(mapPriority(2)).toBe('high')
  })

  test('maps 3 to medium', () => {
    expect(mapPriority(3)).toBe('medium')
  })

  test('maps 4 to low', () => {
    expect(mapPriority(4)).toBe('low')
  })

  test('maps unknown value to no-priority', () => {
    expect(mapPriority(99)).toBe('no-priority')
  })
})

describe('blocked_by frontmatter round-trip', () => {
  test('buildDescriptionWithRelations emits blocked_by line', () => {
    const desc = buildDescriptionWithRelations('Task body.', [{ type: 'blocked_by', taskId: 'task-aaa' }])
    expect(desc).toContain('blocked_by: task-aaa')
  })

  test('parseRelationsFromDescription reads blocked_by line', () => {
    const desc = buildDescriptionWithRelations('Body.', [{ type: 'blocked_by', taskId: 'task-bbb' }])
    const { relations, body } = parseRelationsFromDescription(desc)
    expect(body).toBe('Body.')
    expect(relations).toHaveLength(1)
    expect(relations[0]).toEqual({ type: 'blocked_by', taskId: 'task-bbb' })
  })

  test('blocks and blocked_by coexist correctly', () => {
    const desc = buildDescriptionWithRelations('Body.', [
      { type: 'blocks', taskId: 'task-ccc' },
      { type: 'blocked_by', taskId: 'task-ddd' },
    ])
    const { relations } = parseRelationsFromDescription(desc)
    expect(relations).toHaveLength(2)
    expect(relations.find((r) => r.type === 'blocks')?.taskId).toBe('task-ccc')
    expect(relations.find((r) => r.type === 'blocked_by')?.taskId).toBe('task-ddd')
  })
})

describe('duplicate_of frontmatter round-trip', () => {
  test('buildDescriptionWithRelations emits duplicate_of line', () => {
    const desc = buildDescriptionWithRelations('Task body.', [{ type: 'duplicate_of', taskId: 'task-eee' }])
    expect(desc).toContain('duplicate_of: task-eee')
  })

  test('parseRelationsFromDescription reads duplicate_of line', () => {
    const desc = buildDescriptionWithRelations('Body.', [{ type: 'duplicate_of', taskId: 'task-fff' }])
    const { relations, body } = parseRelationsFromDescription(desc)
    expect(body).toBe('Body.')
    expect(relations).toHaveLength(1)
    expect(relations[0]).toEqual({ type: 'duplicate_of', taskId: 'task-fff' })
  })

  test('duplicate and duplicate_of coexist correctly', () => {
    const desc = buildDescriptionWithRelations('Body.', [
      { type: 'duplicate', taskId: 'task-ggg' },
      { type: 'duplicate_of', taskId: 'task-hhh' },
    ])
    const { relations } = parseRelationsFromDescription(desc)
    expect(relations).toHaveLength(2)
    expect(relations.find((r) => r.type === 'duplicate')?.taskId).toBe('task-ggg')
    expect(relations.find((r) => r.type === 'duplicate_of')?.taskId).toBe('task-hhh')
  })
})

describe('frontmatter round-trip in patchRelations context', () => {
  test('parseRelationsFromDescription correctly extracts body from frontmatter', () => {
    const description = buildDescriptionWithRelations('Original task body.', [{ type: 'blocks', taskId: 'task-abc' }])
    const { body, relations } = parseRelationsFromDescription(description)
    expect(body).toBe('Original task body.')
    expect(relations).toHaveLength(1)
    expect(relations[0]).toEqual({ type: 'blocks', taskId: 'task-abc' })
  })

  test('parseRelationsFromDescription returns full description as body when no frontmatter', () => {
    const { body, relations } = parseRelationsFromDescription('Plain description, no frontmatter.')
    expect(body).toBe('Plain description, no frontmatter.')
    expect(relations).toHaveLength(0)
  })

  test('rebuilding with updated relations produces correct frontmatter', () => {
    const original = buildDescriptionWithRelations('Task body.', [{ type: 'blocks', taskId: 'task-111' }])
    const { body } = parseRelationsFromDescription(original)
    const updated = buildDescriptionWithRelations(body, [
      { type: 'blocks', taskId: 'task-111' },
      { type: 'related', taskId: 'task-222' },
    ])
    const { relations } = parseRelationsFromDescription(updated)
    expect(relations).toHaveLength(2)
  })
})

describe('EnsureColumnsResult interface', () => {
  test('EnsureColumnsResult interface has stateToColumnId and newCount', () => {
    const result: import('../../src/scripts/kaneo-import.js').EnsureColumnsResult = {
      stateToColumnId: new Map([['Todo', 'col-1']]),
      newCount: 1,
    }
    expect(result.newCount).toBe(1)
    expect(result.stateToColumnId.get('Todo')).toBe('col-1')
  })
})
