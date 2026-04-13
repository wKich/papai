import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { Readable, Writable } from 'node:stream'

import * as acp from '@agentclientprotocol/sdk'

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
  close(): Promise<void>
}

function createRuntimeClient(
  listeners: Array<(params: acp.SessionNotification) => void>,
  appendTranscript: (direction: 'in' | 'out', payload: unknown) => Promise<void>,
): acp.Client {
  return {
    async sessionUpdate(params: acp.SessionNotification): Promise<void> {
      await appendTranscript('in', params)
      for (const listener of listeners) {
        listener(params)
      }
    },
    requestPermission(): Promise<acp.RequestPermissionResponse> {
      throw new Error('Permission handling is wired in Task 4')
    },
  }
}

function buildClientMethods(
  connection: acp.ClientSideConnection,
  appendTranscript: (direction: 'in' | 'out', payload: unknown) => Promise<void>,
  listeners: Array<(params: acp.SessionNotification) => void>,
  processHandle: ChildProcess,
): AcpProcessClient {
  return {
    async initialize(): Promise<void> {
      await appendTranscript('out', { method: 'initialize' })
      await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      })
    },
    async newSession(cwd: string): Promise<{ sessionId: string }> {
      await appendTranscript('out', { method: 'session/new', cwd })
      return connection.newSession({ cwd, mcpServers: [] })
    },
    async loadSession(sessionId: string, cwd: string): Promise<void> {
      await appendTranscript('out', { method: 'session/load', sessionId, cwd })
      await connection.loadSession({ sessionId, cwd, mcpServers: [] })
    },
    async setConfigOption(sessionId: string, configId: string, value: string): Promise<void> {
      await appendTranscript('out', { method: 'session/set_config_option', sessionId, configId, value })
      await connection.setSessionConfigOption({ sessionId, configId, value })
    },
    async prompt(sessionId: string, text: string): Promise<{ stopReason: string }> {
      await appendTranscript('out', { method: 'session/prompt', sessionId, text })
      return connection.prompt({
        sessionId,
        prompt: [{ type: 'text', text }],
      })
    },
    onSessionUpdate(listener: (params: acp.SessionNotification) => void): void {
      listeners.push(listener)
    },
    close(): Promise<void> {
      processHandle.kill()
      return Promise.resolve()
    },
  }
}

function isUint8ArrayReadableStream(stream: unknown): stream is ReadableStream<Uint8Array> {
  return stream instanceof ReadableStream
}

function createAcpStream(stdin: NodeJS.WritableStream, stdout: NodeJS.ReadableStream): acp.Stream {
  const writableStream = Writable.toWeb(stdin) as WritableStream<Uint8Array>
  const readableAny: unknown = Readable.toWeb(stdout)

  if (isUint8ArrayReadableStream(readableAny)) {
    return acp.ndJsonStream(writableStream, readableAny)
  }

  throw new Error('Failed to convert stdout to ReadableStream<Uint8Array>')
}

export function createAcpProcessClient(spec: AcpProcessSpec): AcpProcessClient {
  const processHandle = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ['pipe', 'pipe', 'inherit'],
  })

  const listeners: Array<(params: acp.SessionNotification) => void> = []

  async function appendTranscript(direction: 'in' | 'out', payload: unknown): Promise<void> {
    await appendFile(spec.transcriptPath, `${JSON.stringify({ direction, payload })}\n`)
  }

  const runtimeClient = createRuntimeClient(listeners, appendTranscript)

  const stream = createAcpStream(processHandle.stdin, processHandle.stdout)

  const connection = new acp.ClientSideConnection(() => runtimeClient, stream)

  return buildClientMethods(connection, appendTranscript, listeners, processHandle)
}
