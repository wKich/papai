// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { DepthProfile } from './events.js'

/**
 * Pure start-verb argument parsing (extracted from cli.ts at the max-lines
 * seam) — the seam the command-doc flag pin runs against. Strict: an
 * unrecognized token rejects loudly so a doc flag the parser silently ignores
 * cannot exist.
 */

function parseDepth(raw: string | undefined): DepthProfile | undefined {
  if (raw === undefined) return undefined
  if (raw === 'S' || raw === 'M' || raw === 'L') return raw
  throw new Error(`invalid --depth '${raw}' (expected S, M, or L)`)
}

export interface StartArgs {
  readonly taskFile: string
  readonly depthOverride?: DepthProfile
  /** U3 D1: arms the run for execution — appends the armed fact event at start. */
  readonly execute?: boolean
}

export function parseStartArgs(args: readonly string[]): StartArgs {
  const taskFile = args[0]
  if (taskFile === undefined || taskFile.length === 0) {
    throw new Error('usage: afk-runner start <taskFile> [--depth S|M|L] [--execute]')
  }
  let depthOverride: DepthProfile | undefined
  let execute = false
  let index = 1
  while (index < args.length) {
    const token = args[index]
    if (token === '--depth') {
      depthOverride = parseDepth(args[index + 1])
      index += 2
    } else if (token === '--execute') {
      execute = true
      index += 1
    } else {
      throw new Error(
        `unexpected start argument '${token}' (usage: afk-runner start <taskFile> [--depth S|M|L] [--execute])`,
      )
    }
  }
  const base: StartArgs = execute ? { taskFile, execute: true } : { taskFile }
  return depthOverride === undefined ? base : { ...base, depthOverride }
}
