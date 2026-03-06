import { describe, expect, test } from 'bun:test'

import * as linear from '../../src/linear/index.js'

describe('linear index exports', () => {
  test('exports all 22 Linear functions', () => {
    expect(typeof linear.createIssue).toBe('function')
    expect(typeof linear.updateIssue).toBe('function')
    expect(typeof linear.searchIssues).toBe('function')
    expect(typeof linear.listProjects).toBe('function')
    expect(typeof linear.updateProject).toBe('function')
    expect(typeof linear.archiveProject).toBe('function')
    expect(typeof linear.addIssueComment).toBe('function')
    expect(typeof linear.getIssueComments).toBe('function')
    expect(typeof linear.updateIssueComment).toBe('function')
    expect(typeof linear.removeIssueComment).toBe('function')
    expect(typeof linear.listLabels).toBe('function')
    expect(typeof linear.createLabel).toBe('function')
    expect(typeof linear.updateLabel).toBe('function')
    expect(typeof linear.removeLabel).toBe('function')
    expect(typeof linear.addIssueLabel).toBe('function')
    expect(typeof linear.removeIssueLabel).toBe('function')
    expect(typeof linear.addIssueRelation).toBe('function')
    expect(typeof linear.updateIssueRelation).toBe('function')
    expect(typeof linear.removeIssueRelation).toBe('function')
    expect(typeof linear.getIssue).toBe('function')
    expect(typeof linear.createProject).toBe('function')
    expect(typeof linear.archiveIssue).toBe('function')
  })
})
