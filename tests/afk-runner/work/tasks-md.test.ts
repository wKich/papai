// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { parseTaskItems, readTaskItemsAt } from '../../../afk-runner/src/work/tasks-md.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-tasks-md-'))
  tmpDirs.push(dir)
  return dir
}

describe('parseTaskItems', () => {
  it('anchors ids to the checkbox lines in file order and reads checked state and text', () => {
    const items = parseTaskItems(
      [
        '## 1. Group',
        '',
        '- [ ] 1.1 first item',
        '- [x] 1.2 second item',
        '- [X] 1.3 third item',
        'plain line',
        '',
      ].join('\n'),
    )
    expect(items).toEqual([
      { id: '1', lineNo: 3, checked: false, text: '1.1 first item' },
      { id: '2', lineNo: 4, checked: true, text: '1.2 second item' },
      { id: '3', lineNo: 5, checked: true, text: '1.3 third item' },
    ])
  })

  it('indented checkbox lines parse and non-checkbox lines never anchor an id', () => {
    const items = parseTaskItems(['  - [ ] nested', 'not a task', '- [ ] after'].join('\n'))
    expect(items.map((item) => item.id)).toEqual(['1', '2'])
    expect(items.map((item) => item.lineNo)).toEqual([1, 3])
  })
})

describe('readTaskItemsAt', () => {
  it('reads the change folder tasks.md synchronously', () => {
    const dir = makeDir()
    fs.writeFileSync(path.join(dir, 'tasks.md'), '- [x] only item\n')
    expect(readTaskItemsAt(dir)).toEqual([{ id: '1', lineNo: 1, checked: true, text: 'only item' }])
  })

  it('a missing or unreadable tasks.md folds as no items owed', () => {
    expect(readTaskItemsAt(makeDir())).toEqual([])
  })
})
