// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { AFFECTED_CHECK_COMMAND, EXEC_CHECK_WALL_CAP_MS, bunRunCheck } from '../../../afk-runner/src/work/run-check.js'

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

interface SeenSpawnOptions {
  readonly cwd?: string
  readonly stdout?: string
  readonly stderr?: string
  readonly timeout?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function readSeenOptions(value: unknown): SeenSpawnOptions {
  if (!isRecord(value)) return {}
  const { cwd, stdout, stderr, timeout } = value
  return {
    ...(typeof cwd === 'string' ? { cwd } : {}),
    ...(typeof stdout === 'string' ? { stdout } : {}),
    ...(typeof stderr === 'string' ? { stderr } : {}),
    ...(typeof timeout === 'number' ? { timeout } : {}),
  }
}

/**
 * The spawn-side wall cap (walk-robustness F-U3): the production check seam
 * never hangs the walk — a timed-out check is red with a cap-naming marker.
 */
describe('wall cap (walk-robustness F-U3)', () => {
  const realSpawnSync = Bun.spawnSync
  const seenOptions: SeenSpawnOptions[] = []
  let result: Bun.SyncSubprocess | null = null

  afterEach(() => {
    Bun.spawnSync = realSpawnSync
    seenOptions.length = 0
    result = null
  })

  function stubSpawnSync(): void {
    // The rest-args form type-checks against both spawnSync overloads without
    // a narrowing assertion; the production call is always cmds-first.
    Bun.spawnSync = (...args: unknown[]): Bun.SyncSubprocess => {
      const cmds = args[0]
      if (!Array.isArray(cmds) || cmds.join(' ') !== 'bun run test:affected') {
        throw new Error(`unexpected spawn: ${String(cmds)}`)
      }
      seenOptions.push(readSeenOptions(args[1]))
      if (result === null) throw new Error('no scripted spawn result')
      return result
    }
  }

  /** A genuine Bun timeout result — a real short-capped spawn (design D4's short-cap double), stdout/stderr scripted. */
  function timeoutShapedResult(stdout = '', stderr = ''): Bun.SyncSubprocess {
    const killed = Bun.spawnSync(['bun', '-e', 'setTimeout(() => {}, 30000)'], {
      cwd: os.tmpdir(),
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 200,
    })
    return { ...killed, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) }
  }

  it('the cap is the compiled 30-minute spawn-side precedent', () => {
    expect(EXEC_CHECK_WALL_CAP_MS).toBe(1_800_000)
  })

  it("Bun's own contract pin: a spawn exceeding its timeout reports exitedDueToTimeout with a null exitCode", () => {
    const proc = Bun.spawnSync(['bun', '-e', 'setTimeout(() => {}, 30000)'], {
      cwd: os.tmpdir(),
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 200,
    })
    expect(proc.exitedDueToTimeout).toBe(true)
    expect(proc.exitCode).toBeNull()
    expect(proc.signalCode).toBe('SIGTERM')
  })

  it('the wrapper passes the compiled cap to the spawn', async () => {
    result = timeoutShapedResult()
    stubSpawnSync()
    await bunRunCheck(os.tmpdir(), ['bun', 'run', 'test:affected'])
    expect(seenOptions).toEqual([
      {
        cwd: os.tmpdir(),
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: EXEC_CHECK_WALL_CAP_MS,
      },
    ])
  })

  it('a timed-out check reports non-zero exit with the cap-naming marker line in stderr', async () => {
    result = timeoutShapedResult('partial stdout', 'suite still running')
    stubSpawnSync()
    const check = await bunRunCheck(os.tmpdir(), ['bun', 'run', 'test:affected'])
    expect(check.exitCode).not.toBe(0)
    expect(check.stdout).toBe('partial stdout')
    expect(check.stderr).toContain('suite still running')
    expect(check.stderr).toContain('check exceeded wall cap (1800000 ms)')
  })

  it('a normal exit passes through unchanged — the cap never fires on a legitimate check', async () => {
    const base = Bun.spawnSync(['bun', '-e', 'process.exit(0)'], { stdout: 'pipe', stderr: 'pipe' })
    result = { ...base, exitCode: 0, success: true, stdout: Buffer.from('green'), stderr: Buffer.from('') }
    stubSpawnSync()
    const check = await bunRunCheck(os.tmpdir(), ['bun', 'run', 'test:affected'])
    expect(check).toEqual({ exitCode: 0, stdout: 'green', stderr: '' })
  })
})
