// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { parseStartArgs } from '../../afk-runner/src/start-args.js'

describe('parseStartArgs — the strict start-arg parser (U3 extraction seam)', () => {
  it('parses a bare task file, --depth with its value, and the boolean --execute flag', () => {
    expect(parseStartArgs(['task.md'])).toEqual({ taskFile: 'task.md' })
    expect(parseStartArgs(['task.md', '--depth', 'L'])).toEqual({ taskFile: 'task.md', depthOverride: 'L' })
    expect(parseStartArgs(['task.md', '--execute'])).toEqual({ taskFile: 'task.md', execute: true })
    expect(parseStartArgs(['task.md', '--depth', 'S', '--execute'])).toEqual({
      taskFile: 'task.md',
      depthOverride: 'S',
      execute: true,
    })
    expect(parseStartArgs(['task.md', '--execute', '--depth', 'M'])).toEqual({
      taskFile: 'task.md',
      depthOverride: 'M',
      execute: true,
    })
  })

  it('rejects a missing task file, an invalid depth, and any unexpected token', () => {
    expect(() => parseStartArgs([])).toThrow('usage: afk-runner start <taskFile> [--depth S|M|L] [--execute]')
    expect(() => parseStartArgs(['task.md', '--depth', 'X'])).toThrow("invalid --depth 'X' (expected S, M, or L)")
    expect(() => parseStartArgs(['task.md', '--execute', 'yes'])).toThrow("unexpected start argument 'yes'")
    expect(() => parseStartArgs(['task.md', '--exec'])).toThrow("unexpected start argument '--exec'")
  })
})
