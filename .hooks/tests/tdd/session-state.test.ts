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
