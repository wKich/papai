// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

import type { SpawnFn } from '../../afk-runner/src/agent-backend/agent-runner.js'
import { composeConfigContent } from '../../afk-runner/src/agent-config.js'
import { mcpFor } from '../../afk-runner/src/mcp-servers.js'
import type { AgentMcpSurface } from '../../afk-runner/src/mcp-servers.js'
import { startRun } from '../../afk-runner/src/run.js'
import type { FakePipeline } from './fixtures/fake-pipeline.js'
import { makeFakePipeline, TASK_TEXT } from './fixtures/fake-pipeline.js'

describe('RunDeps threads the resolved agent-MCP surface (afk-runner-agent-mcp 4.3)', () => {
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
   * The fake pipeline wrapped with a spawn that records each spawn's child
   * env by output basename — no entry means the spawn ran env-inheriting.
   */
  function captureEnvPipeline(): {
    readonly pipeline: FakePipeline
    readonly envs: ReadonlyMap<string, Record<string, string>>
    readonly spawn: SpawnFn
  } {
    const pipeline = makeFakePipeline()
    const envs = new Map<string, Record<string, string>>()
    const spawn: SpawnFn = (command, args, options, onLine) => {
      const basename = String(args[args.length - 1]).match(/\.review-loop\/([\w-]+\.json)/u)?.[1] ?? 'unknown.json'
      if (options.env !== undefined) envs.set(basename, options.env)
      return pipeline.deps.spawn(command, args, options, onLine)
    }
    return { pipeline, envs, spawn }
  }

  function taskFileOf(pipeline: FakePipeline): string {
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    return taskFile
  }

  it('startRun carries an active surface through the work registry to the spawned child env', async () => {
    const { pipeline, envs, spawn } = captureEnvPipeline()
    const halted = await startRun({ ...pipeline.deps, spawn, mcpSurface: SURFACE }, { taskFile: taskFileOf(pipeline) })
    expect(halted.halted).toBe('final')
    const estimatorEnv = envs.get('depth.json')
    assert(estimatorEnv !== undefined)
    expect(estimatorEnv['OPENCODE_CONFIG_CONTENT']).toBe(
      composeConfigContent('test-model', SURFACE, mcpFor(SURFACE, 'estimator')),
    )
  })

  it('an absent surface on RunDeps leaves every spawn env-inheriting (D5 inertness)', async () => {
    const { pipeline, envs, spawn } = captureEnvPipeline()
    const halted = await startRun({ ...pipeline.deps, spawn }, { taskFile: taskFileOf(pipeline) })
    expect(halted.halted).toBe('final')
    expect(pipeline.spawnOrder.length).toBeGreaterThan(0)
    expect(envs.size).toBe(0)
  })
})
