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

/** The production check runner (spawn-free wrapper over Bun.spawnSync, the cli.ts EXEC_* shape). */
export const bunRunCheck: RunCheckFn = (cwd, command) => {
  const proc = Bun.spawnSync([...command], { cwd, stdout: 'pipe', stderr: 'pipe' })
  return Promise.resolve({
    exitCode: proc.exitCode ?? 1,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  })
}
