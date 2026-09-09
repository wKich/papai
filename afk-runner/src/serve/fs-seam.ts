// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, readdir, stat } from 'node:fs/promises'

/**
 * The board's read-only fs seam (web-board D4): the type exposes only read
 * operations — the no-write contract is the seam's shape, not discipline, so
 * the board has no write path to get wrong. A type-level test pins write
 * members absent, mirroring the analyze seam's construction.
 */

export interface ServeStat {
  isFile(): boolean
  isDirectory(): boolean
  readonly size: number
  readonly mtimeMs: number
}

export interface ServeFs {
  readFile(filePath: string): Promise<string>
  readdir(dirPath: string): Promise<string[]>
  stat(targetPath: string): Promise<ServeStat>
}

export function nodeServeFs(): ServeFs {
  return {
    readFile: (filePath) => readFile(filePath, 'utf8'),
    readdir: (dirPath) => readdir(dirPath),
    stat: (targetPath) => stat(targetPath),
  }
}
