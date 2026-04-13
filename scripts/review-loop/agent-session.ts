import type * as acp from '@agentclientprotocol/sdk'

import type { AcpProcessClient } from './acp-process-client.js'

export interface AgentPromptReply {
  text: string
  stopReason: string
}

export interface BootstrappedAgentSession {
  sessionId: string
  availableCommands: string[]
  promptText(text: string): Promise<AgentPromptReply>
}

interface SessionState {
  availableCommands: string[]
  responseChunks: string[]
  commandsResolve: (() => void) | null
}

function setupSessionUpdateListener(client: AcpProcessClient, state: SessionState): void {
  client.onSessionUpdate((params: acp.SessionNotification) => {
    const update = params.update
    if (update.sessionUpdate === 'available_commands_update') {
      state.availableCommands.splice(
        0,
        state.availableCommands.length,
        ...update.availableCommands.map((command) => command.name),
      )
      if (state.commandsResolve !== null) {
        state.commandsResolve()
        state.commandsResolve = null
      }
      return
    }
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
      state.responseChunks.push(update.content.text)
    }
  })
}

async function createOrLoadSession(
  client: AcpProcessClient,
  cwd: string,
  previousSessionId: string | null,
): Promise<string> {
  if (previousSessionId === null) {
    return (await client.newSession(cwd)).sessionId
  }
  await client.loadSession(previousSessionId, cwd)
  return previousSessionId
}

export async function bootstrapAgentSession(
  client: AcpProcessClient,
  options: {
    cwd: string
    previousSessionId: string | null
    sessionConfig: Record<string, string>
  },
): Promise<BootstrappedAgentSession> {
  await client.initialize()

  const state: SessionState = {
    availableCommands: [],
    responseChunks: [],
    commandsResolve: null,
  }

  const commandsPromise = new Promise<void>((resolve) => {
    state.commandsResolve = resolve
  })

  setupSessionUpdateListener(client, state)

  const sessionId = await createOrLoadSession(client, options.cwd, options.previousSessionId)

  await commandsPromise

  await Promise.all(
    Object.entries(options.sessionConfig).map(([configId, value]) =>
      client.setConfigOption(sessionId, configId, value),
    ),
  )

  return {
    sessionId,
    availableCommands: state.availableCommands,
    async promptText(text: string): Promise<AgentPromptReply> {
      state.responseChunks = []
      const result = await client.prompt(sessionId, text)
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve()
        }, 10)
      })
      return {
        text: state.responseChunks.join(''),
        stopReason: result.stopReason,
      }
    },
  }
}
