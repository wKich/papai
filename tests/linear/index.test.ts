import { describe, expect, test } from 'bun:test'

import * as linear from '../../src/linear/index.js'

describe('linear index exports', () => {
  test('exports all 15 Linear functions', () => {
    expect(typeof linear.createIssue).toBe('function')
    expect(typeof linear.updateIssue).toBe('function')
    expect(typeof linear.searchIssues).toBe('function')
    expect(typeof linear.listProjects).toBe('function')
    expect(typeof linear.addComment).toBe('function')
    expect(typeof linear.getComments).toBe('function')
    expect(typeof linear.listLabels).toBe('function')
    expect(typeof linear.getIssueLabels).toBe('function')
    expect(typeof linear.removeIssueLabel).toBe('function')
    expect(typeof linear.createRelation).toBe('function')
    expect(typeof linear.getRelations).toBe('function')
    expect(typeof linear.getIssue).toBe('function')
    expect(typeof linear.createLabel).toBe('function')
    expect(typeof linear.createProject).toBe('function')
    expect(typeof linear.archiveIssue).toBe('function')
  })
})
