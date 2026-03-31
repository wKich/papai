import fs from 'node:fs'
import path from 'node:path'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 1 week

/**
 * File-based backend (Claude Code — hooks run as subprocesses, no shared memory)
 */
export class FileSessionState {
  #filePath

  constructor(sessionId, stateDir) {
    this.#filePath = path.join(stateDir, `tdd-session-${sessionId}.json`)
  }

  #read() {
    try {
      const stat = fs.statSync(this.#filePath)
      if (Date.now() - stat.mtimeMs > SESSION_TTL_MS) {
        fs.unlinkSync(this.#filePath)
        return { writtenTests: [], pendingFailure: null }
      }
      return JSON.parse(fs.readFileSync(this.#filePath, 'utf8'))
    } catch {
      return { writtenTests: [], pendingFailure: null }
    }
  }

  #write(state) {
    fs.mkdirSync(path.dirname(this.#filePath), { recursive: true })
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
      MemorySessionState.#sessions.set(sessionId, {
        writtenTests: [],
        pendingFailure: null,
        surfaceSnapshots: new Map(),
        mutationSnapshots: new Map(),
        coverageBaseline: null,
      })
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

  // Surface snapshots (check [2] and [6])
  getSurfaceSnapshot(fileKey) {
    return this.#state.surfaceSnapshots.get(fileKey) ?? null
  }

  setSurfaceSnapshot(fileKey, data) {
    this.#state.surfaceSnapshots.set(fileKey, data)
  }

  // Mutation snapshots (check [3] and [7])
  getMutationSnapshot(fileKey) {
    return this.#state.mutationSnapshots.get(fileKey) ?? null
  }

  setMutationSnapshot(fileKey, data) {
    this.#state.mutationSnapshots.set(fileKey, data)
  }

  // Session coverage baseline (check [5])
  getCoverageBaseline() {
    return this.#state.coverageBaseline
  }

  setCoverageBaseline(baseline) {
    this.#state.coverageBaseline = baseline
  }

  /** Reset all sessions (for testing) */
  static reset() {
    MemorySessionState.#sessions.clear()
  }
}
