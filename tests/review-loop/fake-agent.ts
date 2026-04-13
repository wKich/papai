#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import readline from 'node:readline'

import { z } from 'zod'

const ScenarioSchema = z.object({
  availableCommands: z.array(z.object({ name: z.string(), description: z.string() })),
  promptReplies: z.array(z.object({ text: z.string() })),
})

const scenarioPath = process.env['ACP_SCENARIO_FILE']
if (scenarioPath === undefined) {
  throw new Error('ACP_SCENARIO_FILE is required')
}

const scenario = ScenarioSchema.parse(JSON.parse(readFileSync(scenarioPath, 'utf8')))
let promptIndex = 0

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const MessageSchema = z.object({
  id: z.number().optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
})

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY,
})

rl.on('line', (line) => {
  const message = MessageSchema.parse(JSON.parse(line))

  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
        },
        authMethods: [],
      },
    })
    return
  }

  if (message.method === 'session/new') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: { sessionId: 'sess_fake' },
    })
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess_fake',
        update: {
          sessionUpdate: 'available_commands_update',
          availableCommands: scenario.availableCommands,
        },
      },
    })
    return
  }

  if (message.method === 'session/load') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: null,
    })
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: message.params?.['sessionId'] ?? 'sess_fake',
        update: {
          sessionUpdate: 'available_commands_update',
          availableCommands: scenario.availableCommands,
        },
      },
    })
    return
  }

  if (message.method === 'session/prompt') {
    const promptReply = scenario.promptReplies[promptIndex] ?? scenario.promptReplies.at(-1) ?? { text: '' }
    promptIndex += 1

    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: message.params?.['sessionId'] ?? 'sess_fake',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text: promptReply.text,
          },
        },
      },
    })

    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        stopReason: 'end_turn',
      },
    })
  }
})
