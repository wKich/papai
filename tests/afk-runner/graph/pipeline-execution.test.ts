// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import path from 'node:path'

import { implementModule, releaseModule, verifyModule } from '../../../afk-runner/src/graph/pipeline-execution.js'
import type { PipelineRunInput, PipelineWorkDeps } from '../../../afk-runner/src/graph/pipeline-work.js'
import { TASK_TEXT, makeFakePipeline } from '../fixtures/fake-pipeline.js'

function executionModules(
  deps: PipelineWorkDeps,
  input: PipelineRunInput,
  runDir: string,
): {
  readonly implement: ReturnType<typeof implementModule>
  readonly verify: ReturnType<typeof verifyModule>
  readonly release: ReturnType<typeof releaseModule>
} {
  return {
    implement: implementModule(deps, input, runDir),
    verify: verifyModule(deps, runDir),
    release: releaseModule(deps, input),
  }
}

describe('the execution-half state modules (U3 D4/D5/D7)', () => {
  it('implement: the walk work with the self/verify successors', () => {
    const pipeline = makeFakePipeline()
    const modules = executionModules(
      pipeline.deps,
      { taskText: TASK_TEXT, changeName: 'add-thing' },
      path.join(pipeline.deps.config.workDir, 'runs', 'probe'),
    )
    expect(modules.implement.work?.kind).toBe('implement')
    expect(modules.implement.successors).toEqual({
      outstanding: { enter: 'implement' },
      done: { enter: 'verify' },
    })
  })

  it('verify: the boundary work with the unverified/green/red successors', () => {
    const pipeline = makeFakePipeline()
    const modules = executionModules(
      pipeline.deps,
      { taskText: TASK_TEXT, changeName: 'add-thing' },
      path.join(pipeline.deps.config.workDir, 'runs', 'probe'),
    )
    expect(modules.verify.work?.kind).toBe('verify')
    expect(modules.verify.successors).toEqual({
      unverified: { enter: 'verify' },
      green: { enter: 'release' },
      red: { enter: 'implement' },
    })
  })

  it('release: the presentation work parking gate-pending', () => {
    const pipeline = makeFakePipeline()
    const modules = executionModules(
      pipeline.deps,
      { taskText: TASK_TEXT, changeName: 'add-thing' },
      path.join(pipeline.deps.config.workDir, 'runs', 'probe'),
    )
    expect(modules.release.work?.kind).toBe('release')
    expect(modules.release.successors).toEqual({
      incomplete: { enter: 'release' },
      presented: { park: 'gate-pending' },
    })
  })
})
