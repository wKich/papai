// tests/providers/youtrack/schemas/custom-fields.test.ts
import { describe, expect, test } from 'bun:test'

import {
  SingleEnumIssueCustomFieldSchema,
  SingleUserIssueCustomFieldSchema,
  TextIssueCustomFieldSchema,
  SimpleIssueCustomFieldSchema,
} from '../../../schemas/youtrack/custom-fields.js'

describe('Custom field schemas', () => {
  test('SingleEnumIssueCustomFieldSchema validates enum field', () => {
    const valid = {
      name: 'Priority',
      $type: 'SingleEnumIssueCustomField',
      value: { name: 'Critical', $type: 'EnumBundleElement' },
    }
    const result = SingleEnumIssueCustomFieldSchema.parse(valid)
    expect(result.name).toBe('Priority')
    expect(result.value.name).toBe('Critical')
  })

  test('SingleUserIssueCustomFieldSchema validates assignee field', () => {
    const valid = {
      name: 'Assignee',
      $type: 'SingleUserIssueCustomField',
      value: { id: '1-1', $type: 'User', login: 'john.doe' },
    }
    const result = SingleUserIssueCustomFieldSchema.parse(valid)
    expect(result.value?.login).toBe('john.doe')
  })

  test('TextIssueCustomFieldSchema validates text field', () => {
    const valid = {
      name: 'Description',
      $type: 'TextIssueCustomField',
      value: { text: 'Description text', $type: 'TextFieldValue' },
    }
    const result = TextIssueCustomFieldSchema.parse(valid)
    expect(result.value.text).toBe('Description text')
  })

  test('SimpleIssueCustomFieldSchema validates date field', () => {
    const valid = {
      name: 'Due Date',
      $type: 'SimpleIssueCustomField',
      value: 1700000000000,
    }
    const result = SimpleIssueCustomFieldSchema.parse(valid)
    expect(result.value).toBe(1700000000000)
  })
})
