import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync as readFileSyncNode, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createAcpProcessClient } from '../../scripts/review-loop/acp-process-client.js'
import { bootstrapAgentSession } from '../../scripts/review-loop/agent-session.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('ACP process client', () => {
  test('initializes the subprocess, creates a session, and collects text replies', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'review-loop-acp-'))
    tempDirs.push(tempDir)

    const scenarioPath = path.join(tempDir, 'reviewer-scenario.json')
    const transcriptPath = path.join(tempDir, 'reviewer.ndjson')
    writeFileSync(
      scenarioPath,
      JSON.stringify(
        {
          availableCommands: [{ name: 'review-code', description: 'Review code' }],
          promptReplies: [{ text: '{"round":1,"issues":[]}' }],
        },
        null,
        2,
      ),
    )

    const client = createAcpProcessClient({
      command: 'bun',
      args: ['tests/review-loop/fake-agent.ts'],
      cwd: process.cwd(),
      env: { ...process.env, ACP_SCENARIO_FILE: scenarioPath },
      transcriptPath,
    })

    const session = await bootstrapAgentSession(client, {
      cwd: process.cwd(),
      previousSessionId: null,
      sessionConfig: {},
    })

    expect(session.availableCommands).toEqual(['review-code'])

    const reply = await session.promptText('/review-code review the current diff')
    expect(reply.stopReason).toBe('end_turn')
    expect(reply.text).toContain('"issues":[]')
    expect(readFileSyncNode(transcriptPath, 'utf8')).toContain('"sessionUpdate":"agent_message_chunk"')

    await client.close()
  })
})
