// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

import { composeConfigContent } from '../../../afk-runner/src/agent-config.js'
import { workForOf } from '../../../afk-runner/src/graph/pipeline-work.js'
import { mcpFor } from '../../../afk-runner/src/mcp-servers.js'
import type { AgentMcpSurface } from '../../../afk-runner/src/mcp-servers.js'
import { startRun } from '../../../afk-runner/src/run.js'
import type { SpawnFn } from '../../../review-loop/src/agent-runner.js'
import type { FakePipeline } from '../fixtures/fake-pipeline.js'
import { TASK_TEXT, makeFakePipeline } from '../fixtures/fake-pipeline.js'

function registryOf(pipeline: FakePipeline): ReturnType<typeof workForOf> {
  return workForOf(
    pipeline.deps,
    { taskText: TASK_TEXT, changeName: 'add-thing' },
    path.join(pipeline.deps.config.workDir, 'runs', 'registry-probe'),
  )
}

/** The declared work kind of a state — null when the state parks or is unknown. */
function workKindOf(workFor: ReturnType<typeof workForOf>, state: string): string | null {
  return workFor(state)?.work?.kind ?? null
}

describe('workForOf — the work registry over the pipeline states', () => {
  it('every composed state declares a module; unknown positions declare none', () => {
    const pipeline = makeFakePipeline()
    const workFor = registryOf(pipeline)
    for (const state of [
      'start',
      'intake',
      'draft',
      'review',
      'decompose',
      'atomicity',
      'implement',
      'gate.awaiting',
    ]) {
      expect(workFor(state)).not.toBeNull()
    }
    expect(workFor('nonsense')).toBeNull()
  })

  it('work kinds name their stage; the two parks declare no work', () => {
    const pipeline = makeFakePipeline()
    const workFor = registryOf(pipeline)
    const kinds: ReadonlyArray<readonly [string, string | null]> = [
      ['start', null],
      ['intake', 'intake'],
      ['draft', 'draft'],
      ['review', 'review'],
      ['decompose', 'decompose'],
      ['atomicity', 'atomicity'],
      ['implement', 'implement'],
      ['gate.awaiting', null],
    ]
    for (const [state, kind] of kinds) {
      expect(workKindOf(workFor, state)).toBe(kind)
    }
  })

  it('start boots into intake and a presented gate parks gate-pending (the two vocabulary parks)', () => {
    const pipeline = makeFakePipeline()
    const workFor = registryOf(pipeline)
    expect(workFor('start')?.successors).toEqual({ boot: { enter: 'intake' } })
    expect(workFor('gate.awaiting')?.successors).toEqual({ awaiting: { park: 'gate-pending' } })
  })

  it('review converges into the tail, parks on a cap-hit, and re-runs itself while work is owed', () => {
    const pipeline = makeFakePipeline()
    const workFor = registryOf(pipeline)
    expect(workFor('review')?.successors).toEqual({
      converged: { enter: 'decompose' },
      'cap-hit': { park: 'gate-pending' },
      incomplete: { enter: 'review' },
    })
  })

  it('the implement walk re-enters itself per owed item and maps all-done onward to verify', () => {
    const pipeline = makeFakePipeline()
    const workFor = registryOf(pipeline)
    expect(workFor('implement')?.successors).toEqual({
      outstanding: { enter: 'implement' },
      done: { enter: 'verify' },
    })
  })
})

describe('agent-MCP surface threading through the factory sites (afk-runner-agent-mcp 4.3)', () => {
  const SURFACE: AgentMcpSurface = {
    servers: {
      notes: { type: 'local', command: ['uvx', 'mcp-notes'] },
      search: { type: 'remote', url: 'https://mcp.example.test/search' },
    },
    narrowing: { reviewer: ['notes'] },
    credentials: undefined,
    warnings: [],
  }

  /**
   * A full run under an active surface whose spawns' child envs are captured
   * by output basename — the RunDeps → PipelineWorkDeps → factory threading
   * observed end to end through `startRun`.
   */
  async function runWithSurface(): Promise<{
    readonly envs: ReadonlyMap<string, Record<string, string>>
    readonly halted: string
  }> {
    const pipeline: FakePipeline = makeFakePipeline()
    const envs = new Map<string, Record<string, string>>()
    const spawn: SpawnFn = (command, args, options, onLine) => {
      const basename = String(args[args.length - 1]).match(/\.review-loop\/([\w-]+\.json)/u)?.[1] ?? 'unknown.json'
      if (options.env !== undefined) envs.set(basename, options.env)
      return pipeline.deps.spawn(command, args, options, onLine)
    }
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const halted = await startRun({ ...pipeline.deps, spawn, mcpSurface: SURFACE }, { taskFile })
    return { envs, halted: halted.halted }
  }

  it('an agentSeamsOf spawn (intake estimator) receives the composed child env', async () => {
    const { envs, halted } = await runWithSurface()
    expect(halted).toBe('final')
    const env = envs.get('depth.json')
    assert(env !== undefined)
    expect(env['OPENCODE_CONFIG_CONTENT']).toBe(
      composeConfigContent('test-model', SURFACE, mcpFor(SURFACE, 'estimator')),
    )
  })

  it('an agentOf spawn (decompose stage) receives the composed child env likewise', async () => {
    const { envs } = await runWithSurface()
    const env = envs.get('decompose-tasks.json')
    assert(env !== undefined)
    expect(env['OPENCODE_CONFIG_CONTENT']).toBe(
      composeConfigContent('test-model', SURFACE, mcpFor(SURFACE, 'decomposer')),
    )
  })
})
