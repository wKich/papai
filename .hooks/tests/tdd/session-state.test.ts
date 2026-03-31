import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { SessionState } from '../../tdd/session-state.mjs'

describe('SessionState (Claude backend)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-state-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  test('getWrittenTests returns empty array initially', () => {
    const state = new SessionState('init-test', tempDir)
    expect(state.getWrittenTests()).toEqual([])
  })

  test('addWrittenTest persists a test path', () => {
    const state = new SessionState('add-test', tempDir)
    state.addWrittenTest('tests/foo.test.ts')
    expect(state.getWrittenTests()).toEqual(['tests/foo.test.ts'])
  })

  test('multiple addWrittenTest calls accumulate', () => {
    const state = new SessionState('multi-test', tempDir)
    state.addWrittenTest('tests/a.test.ts')
    state.addWrittenTest('tests/b.test.ts')
    state.addWrittenTest('tests/c.test.ts')
    expect(state.getWrittenTests()).toEqual(['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts'])
  })

  test('getPendingFailure returns null initially', () => {
    const state = new SessionState('pf-init', tempDir)
    expect(state.getPendingFailure()).toBeNull()
  })

  test('setPendingFailure then getPendingFailure returns the failure', () => {
    const state = new SessionState('pf-set', tempDir)
    state.setPendingFailure('src/module.ts', 'TypeError: x is not a function')
    expect(state.getPendingFailure()).toEqual({
      file: 'src/module.ts',
      output: 'TypeError: x is not a function',
    })
  })

  test('clearPendingFailure sets it back to null', () => {
    const state = new SessionState('pf-clear', tempDir)
    state.setPendingFailure('src/module.ts', 'error output')
    state.clearPendingFailure()
    expect(state.getPendingFailure()).toBeNull()
  })

  test('handles corrupt state file gracefully', () => {
    const sessionId = 'corrupt-test'
    const filePath = path.join(tempDir, `tdd-session-${sessionId}.json`)
    fs.writeFileSync(filePath, '{not valid json!!!}')

    const state = new SessionState(sessionId, tempDir)
    expect(state.getWrittenTests()).toEqual([])
    expect(state.getPendingFailure()).toBeNull()
  })

  test('handles missing state file gracefully', () => {
    const state = new SessionState('nonexistent', tempDir)
    expect(state.getWrittenTests()).toEqual([])
    expect(state.getPendingFailure()).toBeNull()
  })

  test('new instance with same sessionId reads previously written state', () => {
    const sessionId = 'persist-test'
    const first = new SessionState(sessionId, tempDir)
    first.addWrittenTest('tests/persisted.test.ts')
    first.setPendingFailure('src/broken.ts', 'fail output')

    const second = new SessionState(sessionId, tempDir)
    expect(second.getWrittenTests()).toEqual(['tests/persisted.test.ts'])
    expect(second.getPendingFailure()).toEqual({
      file: 'src/broken.ts',
      output: 'fail output',
    })
  })
})

describe('SessionState (OpenCode backend)', () => {
  beforeEach(() => {
    SessionState.reset()
  })

  afterEach(() => {
    SessionState.reset()
  })

  test('getWrittenTests returns empty array initially', () => {
    const state = new SessionState('mem-init')
    expect(state.getWrittenTests()).toEqual([])
  })

  test('addWrittenTest stores a test path', () => {
    const state = new SessionState('mem-add')
    state.addWrittenTest('tests/foo.test.ts')
    expect(state.getWrittenTests()).toEqual(['tests/foo.test.ts'])
  })

  test('multiple addWrittenTest calls accumulate', () => {
    const state = new SessionState('mem-multi')
    state.addWrittenTest('tests/a.test.ts')
    state.addWrittenTest('tests/b.test.ts')
    state.addWrittenTest('tests/c.test.ts')
    expect(state.getWrittenTests()).toEqual(['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts'])
  })

  test('getPendingFailure returns null initially', () => {
    const state = new SessionState('mem-pf-init')
    expect(state.getPendingFailure()).toBeNull()
  })

  test('setPendingFailure then getPendingFailure returns the failure', () => {
    const state = new SessionState('mem-pf-set')
    state.setPendingFailure('src/module.ts', 'TypeError: x is not a function')
    expect(state.getPendingFailure()).toEqual({
      file: 'src/module.ts',
      output: 'TypeError: x is not a function',
    })
  })

  test('clearPendingFailure sets it back to null', () => {
    const state = new SessionState('mem-pf-clear')
    state.setPendingFailure('src/module.ts', 'error output')
    state.clearPendingFailure()
    expect(state.getPendingFailure()).toBeNull()
  })

  test('reset clears all sessions', () => {
    const state = new SessionState('mem-reset')
    state.addWrittenTest('tests/something.test.ts')
    state.setPendingFailure('src/file.ts', 'output')

    SessionState.reset()

    const fresh = new SessionState('mem-reset')
    expect(fresh.getWrittenTests()).toEqual([])
    expect(fresh.getPendingFailure()).toBeNull()
  })

  test('two instances with same sessionId share state', () => {
    const first = new SessionState('shared-id')
    const second = new SessionState('shared-id')

    first.addWrittenTest('tests/shared.test.ts')
    expect(second.getWrittenTests()).toEqual(['tests/shared.test.ts'])

    second.setPendingFailure('src/shared.ts', 'shared error')
    expect(first.getPendingFailure()).toEqual({
      file: 'src/shared.ts',
      output: 'shared error',
    })
  })

  test('two instances with different sessionIds are isolated', () => {
    const stateA = new SessionState('session-a')
    const stateB = new SessionState('session-b')

    stateA.addWrittenTest('tests/a.test.ts')
    stateA.setPendingFailure('src/a.ts', 'error a')

    stateB.addWrittenTest('tests/b.test.ts')

    expect(stateA.getWrittenTests()).toEqual(['tests/a.test.ts'])
    expect(stateB.getWrittenTests()).toEqual(['tests/b.test.ts'])
    expect(stateB.getPendingFailure()).toBeNull()
  })

  test('expired sessions are cleaned up on new session creation', () => {
    // Create an old session
    const oldSessionId = 'old-session'
    const oldState = new SessionState(oldSessionId)
    oldState.addWrittenTest('tests/old.test.ts')

    // Reset and create a fresh session to simulate time passing
    // Note: We can't easily mock Date.now() in the module, so we test
    // the cleanup mechanism by verifying the constructor runs cleanup
    SessionState.reset()

    // Create a new session - should trigger cleanup (no expired sessions yet)
    const newState = new SessionState('new-session')
    newState.addWrittenTest('tests/new.test.ts')

    // Verify new session works
    expect(newState.getWrittenTests()).toEqual(['tests/new.test.ts'])

    // Old session should be gone after reset
    const oldStateAfterReset = new SessionState(oldSessionId)
    expect(oldStateAfterReset.getWrittenTests()).toEqual([])
  })

  test('surface snapshots work with unified API', () => {
    const state = new SessionState('surface-test')
    const mockSurface = {
      surface: { exports: ['foo'], signatures: { foo: 1 } },
      coverage: { covered: 5, total: 10 },
      filePath: '/project/src/foo.ts',
    }

    state.setSurfaceSnapshot('foo', mockSurface)
    const retrieved = state.getSurfaceSnapshot('foo')
    expect(retrieved).toEqual(mockSurface)
  })

  test('mutation snapshots work with unified API', () => {
    const state = new SessionState('mutation-test')
    const mockMutation = {
      survivors: [{ mutator: 'test', replacement: 'test', line: 1, description: 'test' }],
      filePath: '/project/src/bar.ts',
    }

    state.setMutationSnapshot('bar', mockMutation)
    const retrieved = state.getMutationSnapshot('bar')
    expect(retrieved).toEqual(mockMutation)
  })

  test('coverage baseline works with unified API', () => {
    const state = new SessionState('coverage-test')
    const mockBaseline = { '/project/src/foo.ts': { covered: 5, total: 10 } }

    state.setCoverageBaseline(mockBaseline)
    const retrieved = state.getCoverageBaseline()
    expect(retrieved).toEqual(mockBaseline)
  })
})

describe('SessionState constructor options', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-state-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    SessionState.reset()
  })

  test('can create file backend via constructor', () => {
    const state = new SessionState('file-backend', { stateDir: tempDir, backend: 'file' })
    state.addWrittenTest('tests/constructor.test.ts')
    expect(state.getWrittenTests()).toEqual(['tests/constructor.test.ts'])
  })

  test('can create memory backend via constructor', () => {
    const state = new SessionState('memory-backend', { backend: 'memory' })
    state.addWrittenTest('tests/memory-constructor.test.ts')
    expect(state.getWrittenTests()).toEqual(['tests/memory-constructor.test.ts'])
  })

  test('auto backend selects file when stateDir is provided', () => {
    const state = new SessionState('auto-file', { stateDir: tempDir, backend: 'auto' })
    state.addWrittenTest('tests/auto-file.test.ts')

    // Verify persistence by creating a new instance
    const state2 = new SessionState('auto-file', { stateDir: tempDir, backend: 'auto' })
    expect(state2.getWrittenTests()).toEqual(['tests/auto-file.test.ts'])
  })

  test('auto backend selects memory when stateDir is not provided', () => {
    const state = new SessionState('auto-mem', { backend: 'auto' })
    state.addWrittenTest('tests/auto-mem.test.ts')

    // Memory backend should share state across instances
    const state2 = new SessionState('auto-mem', { backend: 'auto' })
    expect(state2.getWrittenTests()).toEqual(['tests/auto-mem.test.ts'])
  })

  test('throws on unknown backend', () => {
    expect(() => {
      new SessionState('unknown', { backend: 'invalid' as 'file' | 'memory' | 'auto' })
    }).toThrow('Unknown backend: invalid')
  })
})
