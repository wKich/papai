// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { ExecGitFn } from '../../afk-runner/src/config.js'
import {
  DiffGuardViolationError,
  changeFolderPrefix,
  guardWorkingTree,
  snapshotWorkingTree,
} from '../../afk-runner/src/write-guard.js'

function porcelainExecGit(stdout: string): ExecGitFn {
  return (): Promise<{ stdout: string; stderr: string }> => Promise.resolve({ stdout, stderr: '' })
}

interface GuardFields {
  readonly allowedPrefix: string
  readonly allowedExcept?: readonly string[]
}

/** Guard over scripted snapshots: the before-set parsed from `before`, the after-snapshot reading `after`. */
function guardBetween(before: string, after: string, guard: GuardFields): Promise<void> {
  const beforeSet = snapshotWorkingTree(porcelainExecGit(before), '/repo')
  return beforeSet.then((set) => guardWorkingTree(porcelainExecGit(after), '/repo', set, guard))
}

describe('write guard modes (U3 D6)', () => {
  it('changeFolderPrefix keeps the trailing slash that makes a prefix-sharing sibling a violation', () => {
    expect(changeFolderPrefix('add-thing')).toBe('openspec/changes/add-thing/')
  })

  it('snapshotWorkingTree parses porcelain entries into repo-relative paths', async () => {
    const snap = await snapshotWorkingTree(porcelainExecGit(' M src/chat/router.ts\n?? task.md\n'), '/repo')
    expect([...snap]).toEqual(['src/chat/router.ts', 'task.md'])
  })

  it('the narrow guard fails any newly dirtied path outside the change folder with the byte-identical message', async () => {
    const narrow: GuardFields = { allowedPrefix: 'openspec/changes/add-thing/' }
    await expect(guardBetween('', ' M src/chat/router.ts\n?? task.md\n', narrow)).rejects.toThrow(
      DiffGuardViolationError,
    )
    await expect(guardBetween('', ' M src/chat/router.ts\n?? task.md\n', narrow)).rejects.toThrow(
      'agent edited files outside the change folder openspec/changes/add-thing/: src/chat/router.ts, task.md',
    )
  })

  it('the widened guard passes source-tree dirt and the change folder itself', async () => {
    await expect(
      guardBetween('', ' M src/chat/router.ts\n?? task.md\n M openspec/changes/add-thing/x.md\n', {
        allowedPrefix: 'openspec/changes/add-thing/',
        allowedExcept: ['openspec/changes/'],
      }),
    ).resolves.toBeUndefined()
  })

  it('the widened guard fails sibling change-folder dirt naming the paths and the protection', async () => {
    await expect(
      guardBetween('', '?? openspec/changes/other-change/x.md\n M openspec/changes/second-sib/y.md\n', {
        allowedPrefix: 'openspec/changes/add-thing/',
        allowedExcept: ['openspec/changes/'],
      }),
    ).rejects.toThrow(
      'agent edited files in a protected change folder (writes under openspec/changes/ must stay within openspec/changes/add-thing/): openspec/changes/other-change/x.md, openspec/changes/second-sib/y.md',
    )
  })

  it('the widened guard fails a prefix-sharing sibling', async () => {
    await expect(
      guardBetween('', '?? openspec/changes/add-thing-extra/spec.md\n', {
        allowedPrefix: 'openspec/changes/add-thing/',
        allowedExcept: ['openspec/changes/'],
      }),
    ).rejects.toThrow(
      'agent edited files in a protected change folder (writes under openspec/changes/ must stay within openspec/changes/add-thing/): openspec/changes/add-thing-extra/spec.md',
    )
  })

  it('pre-existing dirty paths never violate in either mode (snapshot diff)', async () => {
    const dirty = ' M src/chat/router.ts\n?? task.md\n'
    await expect(guardBetween(dirty, dirty, { allowedPrefix: 'openspec/changes/add-thing/' })).resolves.toBeUndefined()
    await expect(
      guardBetween(dirty, dirty, {
        allowedPrefix: 'openspec/changes/add-thing/',
        allowedExcept: ['openspec/changes/'],
      }),
    ).resolves.toBeUndefined()
  })
})
