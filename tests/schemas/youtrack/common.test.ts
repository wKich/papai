// tests/providers/youtrack/schemas/common.test.ts
import { describe, expect, test } from 'bun:test'

import {
  IssueStateEnum,
  IssuePriorityEnum,
  LinkTypeEnum,
  BaseEntitySchema,
  TimestampSchema,
} from '../../../schemas/youtrack/common.js'

describe('YouTrack common schemas', () => {
  test('IssueStateEnum validates valid states', () => {
    expect(IssueStateEnum.parse('Open')).toBe('Open')
    expect(IssueStateEnum.parse('In Progress')).toBe('In Progress')
    expect(IssueStateEnum.parse('Resolved')).toBe('Resolved')
    expect(IssueStateEnum.parse('Closed')).toBe('Closed')
  })

  test('IssuePriorityEnum validates valid priorities', () => {
    expect(IssuePriorityEnum.parse('Critical')).toBe('Critical')
    expect(IssuePriorityEnum.parse('Major')).toBe('Major')
    expect(IssuePriorityEnum.parse('Normal')).toBe('Normal')
    expect(IssuePriorityEnum.parse('Minor')).toBe('Minor')
  })

  test('LinkTypeEnum validates valid link types', () => {
    expect(LinkTypeEnum.parse('Relates')).toBe('Relates')
    expect(LinkTypeEnum.parse('Depend')).toBe('Depend')
    expect(LinkTypeEnum.parse('Duplicate')).toBe('Duplicate')
    expect(LinkTypeEnum.parse('Subtask')).toBe('Subtask')
  })

  test('BaseEntitySchema validates required fields', () => {
    const valid = {
      id: '123',
      $type: 'Issue',
    }
    expect(() => BaseEntitySchema.parse(valid)).not.toThrow()
  })

  test('TimestampSchema accepts number timestamps', () => {
    expect(TimestampSchema.parse(1700000000000)).toBe(1700000000000)
    expect(() => TimestampSchema.parse('not a number')).toThrow()
  })
})
