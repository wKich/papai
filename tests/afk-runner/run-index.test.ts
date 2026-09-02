// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { listPendingGates } from '../../afk-runner/src/run-index.js'
import type { PendingGateEntry } from '../../afk-runner/src/run-index.js'
import { createRunState, loadRunState, saveRunState } from '../../afk-runner/src/run-state.js'

const tmpDirs: string[] = []

function makeWorkDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-run-index-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('listPendingGates — gate mode vocabulary (U3 D7)', () => {
  it('lists a release-mode gate-pending run with its mode intact', async () => {
    const workDir = makeWorkDir()
    const created = await createRunState({
      workDir,
      repoRoot: '/repo',
      changeName: 'exec-run',
    })
    await saveRunState({
      ...created,
      stage: 'gate',
      gate: { mode: 'release', version: 3 },
    })
    const loaded = await loadRunState(workDir, created.runId)
    const pending = await listPendingGates(workDir)
    // The typed expectation is the point: `gateMode: 'release'` must be a
    // legal PendingGateEntry, or this file fails typecheck (CI's typecheck leg).
    const expected: PendingGateEntry = {
      runId: created.runId,
      changeName: 'exec-run',
      gateMode: 'release',
      gateVersion: 3,
      updatedAt: loaded.updatedAt,
    }
    expect(pending).toHaveLength(1)
    expect(pending[0]).toEqual(expected)
  })
})
