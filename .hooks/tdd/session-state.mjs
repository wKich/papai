import fs from 'node:fs'
import path from 'node:path'

/**
 * File-based backend (Claude Code — hooks run as subprocesses, no shared memory)
 */
export class FileSessionState {
  #filePath

  constructor(sessionId, stateDir = '/tmp') {
    this.#filePath = path.join(stateDir, `tdd-session-${sessionId}.json`)
  }

  #read() {
    try {
      return JSON.parse(fs.readFileSync(this.#filePath, 'utf8'))
    } catch {
      return { writtenTests: [], pendingFailure: null }
    }
  }

  #write(state) {
    fs.writeFileSync(this.#filePath, JSON.stringify(state))
  }

  getWrittenTests() {
    return this.#read().writtenTests
  }

  addWrittenTest(testPath) {
    const state = this.#read()
    state.writtenTests.push(testPath)
    this.#write(state)
  }

  getPendingFailure() {
    return this.#read().pendingFailure
  }

  setPendingFailure(file, output) {
    const state = this.#read()
    state.pendingFailure = { file, output }
    this.#write(state)
  }

  clearPendingFailure() {
    const state = this.#read()
    state.pendingFailure = null
    this.#write(state)
  }
}

/**
 * Memory-based backend (OpenCode — plugin runs in-process, closure persists)
 */
export class MemorySessionState {
  static #sessions = new Map()

  #state

  constructor(sessionId) {
    if (!MemorySessionState.#sessions.has(sessionId)) {
      MemorySessionState.#sessions.set(sessionId, { writtenTests: [], pendingFailure: null })
    }
    this.#state = MemorySessionState.#sessions.get(sessionId)
  }

  getWrittenTests() {
    return this.#state.writtenTests
  }

  addWrittenTest(testPath) {
    this.#state.writtenTests.push(testPath)
  }

  getPendingFailure() {
    return this.#state.pendingFailure
  }

  setPendingFailure(file, output) {
    this.#state.pendingFailure = { file, output }
  }

  clearPendingFailure() {
    this.#state.pendingFailure = null
  }

  /** Reset all sessions (for testing) */
  static reset() {
    MemorySessionState.#sessions.clear()
  }
}
