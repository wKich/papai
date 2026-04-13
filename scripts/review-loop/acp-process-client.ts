import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { Readable, Writable } from 'node:stream'

import * as acp from '@agentclientprotocol/sdk'

import { callConnection, waitForProcessSpawn } from './process-lifecycle.js'

export interface AcpProcessSpec {
  command: string
  args: readonly string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  transcriptPath: string
}

export interface AcpProcessClient {
  initialize(): Promise<void>
  newSession(cwd: string): Promise<{ sessionId: string }>
  loadSession(sessionId: string, cwd: string): Promise<void>
  setConfigOption(sessionId: string, configId: string, value: string): Promise<void>
  prompt(sessionId: string, text: string): Promise<{ stopReason: string }>
  onSessionUpdate(listener: (params: acp.SessionNotification) => void): void
  waitForSessionUpdates(): Promise<void>
  close(): Promise<void>
}

const FORCE_KILL_DELAY_MS = 100
const SHUTDOWN_TIMEOUT_MS = 1000

function createRuntimeClient(
  listeners: Array<(params: acp.SessionNotification) => void>,
  pendingSessionUpdates: Set<Promise<void>>,
  appendTranscript: (direction: 'in' | 'out', payload: unknown) => Promise<void>,
): acp.Client {
  let sessionUpdateQueue = Promise.resolve()

  return {
    async sessionUpdate(params: acp.SessionNotification): Promise<void> {
      const pendingUpdate = sessionUpdateQueue.then(async (): Promise<void> => {
        await appendTranscript('in', params)
        for (const listener of listeners) {
          listener(params)
        }
      })

      sessionUpdateQueue = pendingUpdate.catch((error: unknown): void => {
        void error
      })
      pendingSessionUpdates.add(pendingUpdate)
      try {
        await pendingUpdate
      } finally {
        pendingSessionUpdates.delete(pendingUpdate)
      }
    },
    requestPermission(): Promise<acp.RequestPermissionResponse> {
      throw new Error('Permission handling is wired in Task 4')
    },
  }
}

function isUint8ArrayReadableStream(stream: unknown): stream is ReadableStream<Uint8Array> {
  return stream instanceof ReadableStream
}

function createAcpStream(stdin: NodeJS.WritableStream, stdout: NodeJS.ReadableStream): acp.Stream {
  const writableStream = Writable.toWeb(stdin) as WritableStream<Uint8Array>
  const readableStream = Readable.toWeb(stdout)
  if (!isUint8ArrayReadableStream(readableStream)) {
    throw new Error('Failed to convert stdout to ReadableStream<Uint8Array>')
  }
  return acp.ndJsonStream(writableStream, readableStream)
}

function createInitializeMethod(
  connection: acp.ClientSideConnection,
  appendTranscript: (direction: 'in' | 'out', payload: unknown) => Promise<void>,
  processHandle: ChildProcess,
  getProcessError: () => Error | null,
): () => Promise<void> {
  return () =>
    callConnection(processHandle, getProcessError, async () => {
      await appendTranscript('out', { method: 'initialize' })
      await connection.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} })
    })
}

function createNewSessionMethod(
  connection: acp.ClientSideConnection,
  appendTranscript: (direction: 'in' | 'out', payload: unknown) => Promise<void>,
  processHandle: ChildProcess,
  getProcessError: () => Error | null,
): (cwd: string) => Promise<{ sessionId: string }> {
  return (cwd) =>
    callConnection(processHandle, getProcessError, async () => {
      await appendTranscript('out', { method: 'session/new', cwd })
      return connection.newSession({ cwd, mcpServers: [] })
    })
}

function createLoadSessionMethod(
  connection: acp.ClientSideConnection,
  appendTranscript: (direction: 'in' | 'out', payload: unknown) => Promise<void>,
  processHandle: ChildProcess,
  getProcessError: () => Error | null,
): (sessionId: string, cwd: string) => Promise<void> {
  return (sessionId, cwd) =>
    callConnection(processHandle, getProcessError, async () => {
      await appendTranscript('out', { method: 'session/load', sessionId, cwd })
      await connection.loadSession({ sessionId, cwd, mcpServers: [] })
    })
}

function createSetConfigOptionMethod(
  connection: acp.ClientSideConnection,
  appendTranscript: (direction: 'in' | 'out', payload: unknown) => Promise<void>,
  processHandle: ChildProcess,
  getProcessError: () => Error | null,
): (sessionId: string, configId: string, value: string) => Promise<void> {
  return (sessionId, configId, value) =>
    callConnection(processHandle, getProcessError, async () => {
      await appendTranscript('out', { method: 'session/set_config_option', sessionId, configId, value })
      await connection.setSessionConfigOption({ sessionId, configId, value })
    })
}

function createPromptMethod(
  connection: acp.ClientSideConnection,
  appendTranscript: (direction: 'in' | 'out', payload: unknown) => Promise<void>,
  processHandle: ChildProcess,
  getProcessError: () => Error | null,
): (sessionId: string, text: string) => Promise<{ stopReason: string }> {
  return (sessionId, text) =>
    callConnection(processHandle, getProcessError, async () => {
      await appendTranscript('out', { method: 'session/prompt', sessionId, text })
      return connection.prompt({ sessionId, prompt: [{ type: 'text', text }] })
    })
}

function createWaitForSessionUpdatesMethod(pendingSessionUpdates: Set<Promise<void>>): () => Promise<void> {
  async function drainPendingSessionUpdates(): Promise<void> {
    if (pendingSessionUpdates.size === 0) {
      return
    }
    await Promise.all([...pendingSessionUpdates])
    await drainPendingSessionUpdates()
  }
  return drainPendingSessionUpdates
}

function createCloseMethod(
  processHandle: ChildProcess,
  waitForSessionUpdates: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    if (processHandle.exitCode === null && processHandle.signalCode === null) {
      await new Promise<void>((resolve, reject) => {
        const handleClose = (): void => {
          cleanup()
          resolve()
        }
        const cleanup = (): void => {
          clearTimeout(forceKillTimeout)
          clearTimeout(shutdownTimeout)
          processHandle.off('close', handleClose)
        }
        const forceKillTimeout = setTimeout(() => {
          if (processHandle.exitCode === null && processHandle.signalCode === null) {
            processHandle.kill('SIGKILL')
          }
        }, FORCE_KILL_DELAY_MS)
        const shutdownTimeout = setTimeout(() => {
          cleanup()
          reject(new Error('ACP subprocess did not exit cleanly during shutdown'))
        }, SHUTDOWN_TIMEOUT_MS)
        processHandle.once('close', handleClose)
        const killed = processHandle.kill()
        if (!killed && (processHandle.exitCode !== null || processHandle.signalCode !== null)) {
          cleanup()
          resolve()
        }
      })
    }
    await waitForSessionUpdates()
  }
}

export async function createAcpProcessClient(spec: AcpProcessSpec): Promise<AcpProcessClient> {
  const processHandle = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  let processError: Error | null = null
  const listeners: Array<(params: acp.SessionNotification) => void> = []
  const pendingSessionUpdates = new Set<Promise<void>>()
  processHandle.once('error', (error) => {
    processError = error instanceof Error ? error : new Error(String(error))
  })
  async function appendTranscript(direction: 'in' | 'out', payload: unknown): Promise<void> {
    await appendFile(spec.transcriptPath, `${JSON.stringify({ direction, payload })}\n`)
  }
  await waitForProcessSpawn(processHandle, () => processError)
  const runtimeClient = createRuntimeClient(listeners, pendingSessionUpdates, appendTranscript)
  const stream = createAcpStream(processHandle.stdin, processHandle.stdout)
  const connection = new acp.ClientSideConnection(() => runtimeClient, stream)
  const waitForSessionUpdates = createWaitForSessionUpdatesMethod(pendingSessionUpdates)
  return {
    initialize: createInitializeMethod(connection, appendTranscript, processHandle, () => processError),
    newSession: createNewSessionMethod(connection, appendTranscript, processHandle, () => processError),
    loadSession: createLoadSessionMethod(connection, appendTranscript, processHandle, () => processError),
    setConfigOption: createSetConfigOptionMethod(connection, appendTranscript, processHandle, () => processError),
    prompt: createPromptMethod(connection, appendTranscript, processHandle, () => processError),
    onSessionUpdate(listener: (params: acp.SessionNotification) => void): void {
      listeners.push(listener)
    },
    waitForSessionUpdates,
    close: createCloseMethod(processHandle, waitForSessionUpdates),
  }
}
