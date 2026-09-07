// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { AFFECTED_CHECK_COMMAND, bunRunCheck } from '../../../afk-runner/src/work/run-check.js'

const tmpDirs: string[] = []

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('bunRunCheck', () => {
  it('a succeeding command reports exit 0 and captured stdout', async () => {
    const result = await bunRunCheck(os.tmpdir(), ['bun', '-e', 'console.log("check-ok")'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('check-ok')
  })

  it('a failing command reports the non-zero exit and stderr', async () => {
    const result = await bunRunCheck(os.tmpdir(), ['bun', '-e', 'process.exit(3)'])
    expect(result.exitCode).toBe(3)
  })

  it('the command runs resolved against the given cwd', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-run-check-'))
    const result = await bunRunCheck(dir, ['bun', '-e', 'console.log(process.cwd())'])
    expect(result.stdout).toContain(dir)
  })
})

describe('AFFECTED_CHECK_COMMAND', () => {
  it('is the compiled affected-check command — no paths, the script self-selects from the tree', () => {
    expect(AFFECTED_CHECK_COMMAND).toEqual(['bun', 'run', 'test:affected'])
  })
})
