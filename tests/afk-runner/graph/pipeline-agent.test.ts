// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { WorkIO } from '../../../afk-runner/src/drive/loop.js'
import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import { stampEvent } from '../../../afk-runner/src/events.js'
import { GATE_AWAITING_MODULE, agentSeamsOf, sidecarDirOf } from '../../../afk-runner/src/graph/pipeline-agent.js'
import { initialKernelContext } from '../../../afk-runner/src/kernel/machine.js'
import type { AgentMcpSurface } from '../../../afk-runner/src/mcp-servers.js'
import { makeFakePipeline } from '../fixtures/fake-pipeline.js'

const IO_OF = (appended: SddEvent[]): WorkIO => ({
  runDir: '/runs/r1',
  append: (event: EventInput): SddEvent => {
    const stamped = stampEvent(event, appended.length + 1, '2026-09-03T00:00:00.000Z')
    appended.push(stamped)
    return stamped
  },
  context: initialKernelContext({}),
})

describe('pipeline-agent seams (extracted from pipeline-work at the max-lines seam)', () => {
  it('sidecarDirOf nests sidecars under the run dir', () => {
    expect(sidecarDirOf(IO_OF([]))).toBe('/runs/r1/sidecars')
  })

  it('agentSeamsOf wires the deps through the io append boundary', () => {
    const pipeline = makeFakePipeline()
    const appended: SddEvent[] = []
    const agent = agentSeamsOf(pipeline.deps, IO_OF(appended))
    expect(agent.config).toBe(pipeline.deps.config)
    agent.emit({ altitude: 'L1', type: 'spawned', agent: 'a', role: 'reviewer', model: 'm' })
    expect(appended).toHaveLength(1)
  })

  describe('agentSeamsOf threads the resolved agent-MCP surface (afk-runner-agent-mcp 4.3)', () => {
    const SURFACE: AgentMcpSurface = {
      servers: { search: { type: 'remote', url: 'https://mcp.example.test/search' } },
      narrowing: undefined,
      credentials: undefined,
      warnings: [],
    }

    it('carries an active surface onto the built agent deps', () => {
      const pipeline = makeFakePipeline()
      const agent = agentSeamsOf({ ...pipeline.deps, mcpSurface: SURFACE }, IO_OF([]))
      expect(agent.mcpSurface).toBe(SURFACE)
    })

    it('leaves the field off for an absent surface — byte-identical inertness (D5)', () => {
      const pipeline = makeFakePipeline()
      const agent = agentSeamsOf(pipeline.deps, IO_OF([]))
      expect(Object.hasOwn(agent, 'mcpSurface')).toBe(false)
    })
  })

  it('the gate compound parks gate-pending awaiting a settle', () => {
    expect(GATE_AWAITING_MODULE.work).toBeNull()
    expect(GATE_AWAITING_MODULE.successors).toEqual({ awaiting: { park: 'gate-pending' } })
  })
})
