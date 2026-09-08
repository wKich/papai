// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Split a string into chunks no longer than `budget`, cutting at the last
 * paragraph break before the budget, else the last line break, else a hard
 * cut at the budget. A hard cut that would split a UTF-16 surrogate pair is
 * nudged one code unit left so an astral character is never orphaned, and
 * leading boundary newlines are trimmed from each remainder before the next
 * split.
 */
export function chunkForTelegram(input: string, budget: number): string[] {
  const chunks: string[] = []
  let remainder = input
  while (remainder.length > budget) {
    const cut = findCutIndex(remainder, budget)
    chunks.push(remainder.slice(0, cut))
    remainder = remainder.slice(cut).replace(/^\n+/u, '')
  }
  if (remainder.length > 0 || chunks.length === 0) {
    chunks.push(remainder)
  }
  return chunks
}

function findCutIndex(text: string, budget: number): number {
  const paragraph = text.lastIndexOf('\n\n', budget)
  if (paragraph > 0) return paragraph

  const line = text.lastIndexOf('\n', budget)
  if (line > 0) return line

  if (splitsSurrogatePair(text, budget)) return Math.max(1, budget - 1)
  return Math.max(1, budget)
}

function splitsSurrogatePair(text: string, cut: number): boolean {
  return isHighSurrogate(text.charCodeAt(cut - 1)) && isLowSurrogate(text.charCodeAt(cut))
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff
}
