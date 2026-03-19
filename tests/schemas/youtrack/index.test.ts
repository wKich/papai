// tests/providers/youtrack/schemas/index.test.ts
import { describe, expect, test } from 'bun:test'

import * as schemas from '../../../schemas/youtrack/index.js'

describe('Schema index exports', () => {
  test('exports all common schemas', () => {
    expect(schemas.IssueStateEnum).toBeDefined()
    expect(schemas.IssuePriorityEnum).toBeDefined()
    expect(schemas.LinkTypeEnum).toBeDefined()
    expect(schemas.BaseEntitySchema).toBeDefined()
    expect(schemas.TimestampSchema).toBeDefined()
  })

  test('exports all user schemas', () => {
    expect(schemas.UserSchema).toBeDefined()
    expect(schemas.UserReferenceSchema).toBeDefined()
  })

  test('exports all project schemas', () => {
    expect(schemas.ProjectSchema).toBeDefined()
    expect(schemas.CreateProjectRequestSchema).toBeDefined()
    expect(schemas.ListProjectsRequestSchema).toBeDefined()
  })

  test('exports all custom field schemas', () => {
    expect(schemas.SingleEnumIssueCustomFieldSchema).toBeDefined()
    expect(schemas.SingleUserIssueCustomFieldSchema).toBeDefined()
    expect(schemas.CustomFieldValueSchema).toBeDefined()
  })

  test('exports all tag schemas', () => {
    expect(schemas.TagSchema).toBeDefined()
    expect(schemas.CreateTagRequestSchema).toBeDefined()
    expect(schemas.AddTagToIssueRequestSchema).toBeDefined()
  })

  test('exports all issue schemas', () => {
    expect(schemas.IssueSchema).toBeDefined()
    expect(schemas.CreateIssueRequestSchema).toBeDefined()
    expect(schemas.SearchIssuesRequestSchema).toBeDefined()
  })

  test('exports all comment schemas', () => {
    expect(schemas.CommentSchema).toBeDefined()
    expect(schemas.CreateCommentRequestSchema).toBeDefined()
    expect(schemas.ListCommentsRequestSchema).toBeDefined()
  })

  test('exports all issue link schemas', () => {
    expect(schemas.IssueLinkSchema).toBeDefined()
    expect(schemas.IssueLinkTypeSchema).toBeDefined()
    expect(schemas.CreateIssueLinkRequestSchema).toBeDefined()
  })

  test('exports all agile schemas', () => {
    expect(schemas.AgileBoardSchema).toBeDefined()
    expect(schemas.AgileColumnSchema).toBeDefined()
    expect(schemas.ListAgileBoardsRequestSchema).toBeDefined()
  })
})
