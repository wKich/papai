import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { FileSessionState, MemorySessionState } from '../../../.hooks/tdd/session-state.mjs'

describe('FileSessionState', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-state-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  test('getWrittenTests returns empty array initially', () => {
    const state = new FileSessionState('init-test', tempDir)
    expect(state.getWrittenTests()).toEqual([])
  })

  test('addWrittenTest persists a test path', () => {
    const state = new FileSessionState('add-test', tempDir)
    state.addWrittenTest('tests/foo.test.ts')
    expect(state.getWrittenTests()).toEqual(['tests/foo.test.ts'])
  })

  test('multiple addWrittenTest calls accumulate', () => {
    const state = new FileSessionState('multi-test', tempDir)
    state.addWrittenTest('tests/a.test.ts')
    state.addWrittenTest('tests/b.test.ts')
    state.addWrittenTest('tests/c.test.ts')
    expect(state.getWrittenTests()).toEqual(['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts'])
  })

  test('getPendingFailure returns null initially', () => {
    const state = new FileSessionState('pf-init', tempDir)
    expect(state.getPendingFailure()).toBeNull()
  })

  test('setPendingFailure then getPendingFailure returns the failure', () => {
    const state = new FileSessionState('pf-set', tempDir)
    state.setPendingFailure('src/module.ts', 'TypeError: x is not a function')
    expect(state.getPendingFailure()).toEqual({
      file: 'src/module.ts',
      output: 'TypeError: x is not a function',
    })
  })

  test('clearPendingFailure sets it back to null', () => {
    const state = new FileSessionState('pf-clear', tempDir)
    state.setPendingFailure('src/module.ts', 'error output')
    state.clearPendingFailure()
    expect(state.getPendingFailure()).toBeNull()
  })

  test('handles corrupt state file gracefully', () => {
    const sessionId = 'corrupt-test'
    const filePath = path.join(tempDir, `tdd-session-${sessionId}.json`)
    fs.writeFileSync(filePath, '{not valid json!!!}')

    const state = new FileSessionState(sessionId, tempDir)
    expect(state.getWrittenTests()).toEqual([])
    expect(state.getPendingFailure()).toBeNull()
  })

  test('handles missing state file gracefully', () => {
    const state = new FileSessionState('nonexistent', tempDir)
    expect(state.getWrittenTests()).toEqual([])
    expect(state.getPendingFailure()).toBeNull()
  })

  test('new instance with same sessionId reads previously written state', () => {
    const sessionId = 'persist-test'
    const first = new FileSessionState(sessionId, tempDir)
    first.addWrittenTest('tests/persisted.test.ts')
    first.setPendingFailure('src/broken.ts', 'fail output')

    const second = new FileSessionState(sessionId, tempDir)
    expect(second.getWrittenTests()).toEqual(['tests/persisted.test.ts'])
    expect(second.getPendingFailure()).toEqual({
      file: 'src/broken.ts',
      output: 'fail output',
    })
  })
})

describe('MemorySessionState', () => {
  beforeEach(() => {
    MemorySessionState.reset()
  })

  afterEach(() => {
    MemorySessionState.reset()
  })

  test('getWrittenTests returns empty array initially', () => {
    const state = new MemorySessionState('mem-init')
    expect(state.getWrittenTests()).toEqual([])
  })

  test('addWrittenTest stores a test path', () => {
    const state = new MemorySessionState('mem-add')
    state.addWrittenTest('tests/foo.test.ts')
    expect(state.getWrittenTests()).toEqual(['tests/foo.test.ts'])
  })

  test('multiple addWrittenTest calls accumulate', () => {
    const state = new MemorySessionState('mem-multi')
    state.addWrittenTest('tests/a.test.ts')
    state.addWrittenTest('tests/b.test.ts')
    state.addWrittenTest('tests/c.test.ts')
    expect(state.getWrittenTests()).toEqual(['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts'])
  })

  test('getPendingFailure returns null initially', () => {
    const state = new MemorySessionState('mem-pf-init')
    expect(state.getPendingFailure()).toBeNull()
  })

  test('setPendingFailure then getPendingFailure returns the failure', () => {
    const state = new MemorySessionState('mem-pf-set')
    state.setPendingFailure('src/module.ts', 'TypeError: x is not a function')
    expect(state.getPendingFailure()).toEqual({
      file: 'src/module.ts',
      output: 'TypeError: x is not a function',
    })
  })

  test('clearPendingFailure sets it back to null', () => {
    const state = new MemorySessionState('mem-pf-clear')
    state.setPendingFailure('src/module.ts', 'error output')
    state.clearPendingFailure()
    expect(state.getPendingFailure()).toBeNull()
  })

  test('reset clears all sessions', () => {
    const state = new MemorySessionState('mem-reset')
    state.addWrittenTest('tests/something.test.ts')
    state.setPendingFailure('src/file.ts', 'output')

    MemorySessionState.reset()

    const fresh = new MemorySessionState('mem-reset')
    expect(fresh.getWrittenTests()).toEqual([])
    expect(fresh.getPendingFailure()).toBeNull()
  })

  test('two instances with same sessionId share state', () => {
    const first = new MemorySessionState('shared-id')
    const second = new MemorySessionState('shared-id')

    first.addWrittenTest('tests/shared.test.ts')
    expect(second.getWrittenTests()).toEqual(['tests/shared.test.ts'])

    second.setPendingFailure('src/shared.ts', 'shared error')
    expect(first.getPendingFailure()).toEqual({
      file: 'src/shared.ts',
      output: 'shared error',
    })
  })

  test('two instances with different sessionIds are isolated', () => {
    const stateA = new MemorySessionState('session-a')
    const stateB = new MemorySessionState('session-b')

    stateA.addWrittenTest('tests/a.test.ts')
    stateA.setPendingFailure('src/a.ts', 'error a')

    stateB.addWrittenTest('tests/b.test.ts')

    expect(stateA.getWrittenTests()).toEqual(['tests/a.test.ts'])
    expect(stateB.getWrittenTests()).toEqual(['tests/b.test.ts'])
    expect(stateB.getPendingFailure()).toBeNull()
  })
})
