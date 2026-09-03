// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFileSync } from 'node:fs'
import path from 'node:path'

export interface TaskItem {
  /** The item's 1-based index anchor over the checkbox lines in file order (U3 D4). */
  readonly id: string
  /** The checkbox line's 1-based line number in the parsed document — the flip target for slice commits. */
  readonly lineNo: number
  readonly checked: boolean
  readonly text: string
}

/**
 * The shared tasks.md walk surface: every checkbox line in file order. The
 * gate digest's counts and the implement walk's item picking parse through
 * this one reader, so the digest can never disagree with the walk about
 * what an item is.
 */
export function parseTaskItems(tasksMd: string): readonly TaskItem[] {
  const items: TaskItem[] = []
  const lines = tasksMd.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)- \[([ xX])\]\s*(.*?)\s*$/u.exec(lines[index] ?? '')
    if (match === null) continue
    items.push({
      id: String(items.length + 1),
      lineNo: index + 1,
      checked: match[2] !== ' ',
      text: match[3] ?? '',
    })
  }
  return items
}

/**
 * Best-effort sync read for the outcome reader: an unreadable tasks.md folds
 * as no items owed, so the state maps onward — the walk's own work throws
 * loudly when work is actually owed against a missing file.
 */
export function readTaskItemsAt(changeDir: string): readonly TaskItem[] {
  try {
    return parseTaskItems(readFileSync(path.join(changeDir, 'tasks.md'), 'utf8'))
  } catch {
    return []
  }
}
