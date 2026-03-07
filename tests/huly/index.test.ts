import { describe, expect, test } from 'bun:test'

import * as huly from '../../src/huly/index.js'

describe('huly index exports', () => {
  test('exports all 22 Huly functions', () => {
    expect(typeof huly.createIssue).toBe('function')
    expect(typeof huly.updateIssue).toBe('function')
    expect(typeof huly.searchIssues).toBe('function')
    expect(typeof huly.listProjects).toBe('function')
    expect(typeof huly.updateProject).toBe('function')
    expect(typeof huly.archiveProject).toBe('function')
    expect(typeof huly.addIssueComment).toBe('function')
    expect(typeof huly.getIssueComments).toBe('function')
    expect(typeof huly.updateIssueComment).toBe('function')
    expect(typeof huly.removeIssueComment).toBe('function')
    expect(typeof huly.listLabels).toBe('function')
    expect(typeof huly.createLabel).toBe('function')
    expect(typeof huly.updateLabel).toBe('function')
    expect(typeof huly.removeLabel).toBe('function')
    expect(typeof huly.addIssueLabel).toBe('function')
    expect(typeof huly.removeIssueLabel).toBe('function')
    expect(typeof huly.addIssueRelation).toBe('function')
    expect(typeof huly.updateIssueRelation).toBe('function')
    expect(typeof huly.removeIssueRelation).toBe('function')
    expect(typeof huly.getIssue).toBe('function')
    expect(typeof huly.createProject).toBe('function')
    expect(typeof huly.archiveIssue).toBe('function')
  })
})
