import { describe, expect, test } from 'bun:test'

import type { LinearLabel, LinearProject, LinearState } from '../../src/scripts/linear-client.js'

describe('LinearLabel type', () => {
  test('has required fields', () => {
    const label: LinearLabel = { id: 'l1', name: 'Bug', color: '#ff0000' }
    expect(label.id).toBe('l1')
    expect(label.name).toBe('Bug')
    expect(label.color).toBe('#ff0000')
  })
})

describe('LinearState type', () => {
  test('has required fields', () => {
    const state: LinearState = { id: 's1', name: 'Todo', color: '#aabbcc', type: 'unstarted', position: 0 }
    expect(state.type).toBe('unstarted')
    expect(state.position).toBe(0)
  })
})

describe('LinearProject type', () => {
  test('has required fields', () => {
    const project: LinearProject = { id: 'p1', name: 'Alpha', description: 'desc', state: 'started' }
    expect(project.state).toBe('started')
  })
})
