// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { initialKernelContext } from '../../../afk-runner/src/kernel/types.js'
import type { StageStatus } from '../../../afk-runner/src/kernel/types.js'

describe('initialKernelContext — the kernel context seed (U3 extraction seam)', () => {
  it('seeds the execution residues unarmed and empty beside the legacy empties', () => {
    const context = initialKernelContext({ intake: 'pending' })
    expect(context.executionArmed).toBe(false)
    expect(context.tasks).toEqual({})
    expect(context.children).toEqual({})
    expect(context.failures).toEqual({})
    expect(context.failureKinds).toEqual({})
    expect(context.gate).toBeNull()
    expect(context.gateOutcome).toBeNull()
    expect(context.gateDeadlineAt).toBeNull()
    expect(context.gateDeadlineReArmed).toBe(false)
  })

  it('keeps the caller-owned stage map by reference and nothing else pre-filled', () => {
    const stages: Readonly<Record<string, StageStatus>> = { intake: 'pending' }
    const context = initialKernelContext(stages)
    expect(context.stages).toBe(stages)
    expect(context.depth).toBeNull()
    expect(context.round).toBeNull()
    expect(context.perRound).toEqual([])
    expect(context.autoDecisions).toEqual([])
  })
})
