// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface CheckResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type RunCheckFn = (cwd: string, command: readonly string[]) => Promise<CheckResult>

/**
 * The per-task affected check command (U3 D4): `test:affected` takes no
 * paths — it derives the changed set from the working tree itself, and
 * between slice commits that tree is exactly the current item's work.
 */
export const AFFECTED_CHECK_COMMAND: readonly string[] = ['bun', 'run', 'test:affected']

/**
 * The wall cap every check spawn carries (walk-robustness F-U3): 30 minutes,
 * the spawn-side precedent — a hung check is never legitimate, so the cap is a
 * design constant, not config. If a target repo legitimately exceeds it, the
 * constant moves with evidence.
 */
export const EXEC_CHECK_WALL_CAP_MS = 1_800_000

/** The one-line stderr marker a timed-out check carries, so red routing names the cause. */
export function checkWallCapMarker(capMs: number): string {
  return `check exceeded wall cap (${String(capMs)} ms)`
}

/** The production check runner (spawn-free wrapper over Bun.spawnSync, the cli.ts EXEC_* shape). */
export const bunRunCheck: RunCheckFn = (cwd, command) => {
  const proc = Bun.spawnSync([...command], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: EXEC_CHECK_WALL_CAP_MS,
  })
  const stdout = new TextDecoder().decode(proc.stdout)
  const stderr = new TextDecoder().decode(proc.stderr)
  if (proc.exitedDueToTimeout === true) {
    // A timed-out check is red, honestly (F-U3): non-zero exit, and the
    // marker names the cap so fix context attributes the failure to the hang.
    const marker = checkWallCapMarker(EXEC_CHECK_WALL_CAP_MS)
    return Promise.resolve({
      exitCode: proc.exitCode ?? 1,
      stdout,
      stderr: stderr.length === 0 ? marker : `${stderr.trimEnd()}\n${marker}`,
    })
  }
  return Promise.resolve({
    exitCode: proc.exitCode ?? 1,
    stdout,
    stderr,
  })
}
