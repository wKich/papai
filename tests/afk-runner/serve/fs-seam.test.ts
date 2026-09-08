// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { ServeFs } from '../../../afk-runner/src/serve/fs-seam.js'
import { nodeServeFs } from '../../../afk-runner/src/serve/fs-seam.js'

/**
 * The board's read-only fs seam (web-board D4): the no-write contract is the
 * seam's shape, not discipline — same construction as the analyze seam.
 */

/** Type-level pin: no write member may ever appear on the fs seam type. */
type WriteMemberAbsent = 'writeFile' extends keyof ServeFs ? 'write members must be absent from ServeFs' : 'read-only'
const WRITE_MEMBER_ABSENT: WriteMemberAbsent = 'read-only'

/** Type-level pin: the seam's full surface is exactly the three read functions. */
type SeamMembers = keyof ServeFs
const SEAM_MEMBERS: readonly SeamMembers[] = ['readFile', 'readdir', 'stat']

describe('serve fs-seam — the read-only seam', () => {
  it('exposes exactly readFile/readdir/stat (type-level pin: write members absent)', () => {
    expect(WRITE_MEMBER_ABSENT).toBe('read-only')
    expect([...SEAM_MEMBERS].sort()).toEqual(['readFile', 'readdir', 'stat'])
    const seam: ServeFs = nodeServeFs()
    expect(Object.keys(seam).sort()).toEqual(['readFile', 'readdir', 'stat'])
    for (const writeMember of ['writeFile', 'appendFile', 'rename', 'rm', 'mkdir', 'unlink']) {
      expect(writeMember in seam).toBe(false)
    }
  })

  it('reads files, listings, and stat fingerprints (size, mtimeMs) through node fs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-serve-fs-'))
    try {
      fs.writeFileSync(path.join(dir, 'a.txt'), 'content')
      fs.mkdirSync(path.join(dir, 'sub'))
      const seam = nodeServeFs()
      expect(await seam.readFile(path.join(dir, 'a.txt'))).toBe('content')
      expect((await seam.readdir(dir)).sort()).toEqual(['a.txt', 'sub'])
      const stat = await seam.stat(path.join(dir, 'a.txt'))
      expect(stat.isFile()).toBe(true)
      expect(stat.isDirectory()).toBe(false)
      expect(stat.size).toBe('content'.length)
      expect(typeof stat.mtimeMs).toBe('number')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
