// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { chunkForTelegram } from '../../../src/chat/telegram/format-chunking.js'

describe('chunkForTelegram', () => {
  test('returns a single chunk for input shorter than the budget', () => {
    expect(chunkForTelegram('short text', 4096)).toEqual(['short text'])
  })

  test('returns single-element array for empty input', () => {
    expect(chunkForTelegram('', 4096)).toEqual([''])
  })

  test('handles exactly-budget input without splitting', () => {
    const input = 'y'.repeat(100)
    expect(chunkForTelegram(input, 100)).toEqual([input])
  })

  test('splits on the last paragraph boundary before the budget', () => {
    const first = 'a'.repeat(1500)
    const second = 'b'.repeat(1500)
    const chunks = chunkForTelegram(`${first}\n\n${second}`, 2000)
    expect(chunks).toEqual([first, second])
  })

  test('prefers the paragraph boundary over an earlier line boundary', () => {
    const chunks = chunkForTelegram('one\ntwo\n\nthree', 12)
    expect(chunks).toEqual(['one\ntwo', 'three'])
  })

  test('splits on the last line boundary when no paragraph break fits', () => {
    const first = 'a'.repeat(50)
    const second = 'b'.repeat(50)
    const chunks = chunkForTelegram(`${first}\n${second}`, 60)
    expect(chunks).toEqual([first, second])
  })

  test('hard-cuts unbroken text at the budget', () => {
    const chunks = chunkForTelegram('x'.repeat(250), 100)
    expect(chunks).toEqual(['x'.repeat(100), 'x'.repeat(100), 'x'.repeat(50)])
  })

  test('nudges a hard cut left when it would split a surrogate pair', () => {
    const head = 'a'.repeat(5)
    const input = head + '😀'.repeat(4)
    const chunks = chunkForTelegram(input, 10)
    expect(chunks).toEqual([head + '😀'.repeat(2), '😀'.repeat(2)])
  })

  test('keeps a hard cut between astral characters unnudged', () => {
    const chunks = chunkForTelegram('😀'.repeat(10), 8)
    expect(chunks).toEqual(['😀'.repeat(4), '😀'.repeat(4), '😀'.repeat(2)])
  })

  test('trims leading boundary newlines from continuation chunks', () => {
    const first = 'a'.repeat(50)
    const second = 'b'.repeat(50)
    const chunks = chunkForTelegram(`${first}\n\n\n${second}`, 60)
    expect(chunks).toEqual([`${first}\n`, second])
    for (const chunk of chunks.slice(1)) {
      expect(chunk.startsWith('\n')).toBe(false)
    }
  })

  test('drops a trailing separator remainder instead of emitting an empty chunk', () => {
    const input = 'a'.repeat(100) + '\n\n'
    expect(chunkForTelegram(input, 100)).toEqual(['a'.repeat(100)])
  })

  test('never returns empty chunks for a zero budget', () => {
    expect(chunkForTelegram('abc', 0)).toEqual(['a', 'b', 'c'])
  })

  test('honours an explicitly reduced budget over the adapter default', () => {
    const first = 'a'.repeat(60)
    const second = 'b'.repeat(60)
    const input = `${first}\n\n${second}`
    expect(chunkForTelegram(input, 4096)).toEqual([input])
    expect(chunkForTelegram(input, 70)).toEqual([first, second])
  })

  test('keeps every chunk within the budget on mixed content', () => {
    const input =
      'first paragraph\nwith a second line\n\nemoji 😀 tail\n\n' + 'x'.repeat(120) + '\n\nlast one'
    const chunks = chunkForTelegram(input, 80)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(80)
      expect(chunk.length).toBeGreaterThan(0)
      expect(chunk.startsWith('\n')).toBe(false)
    }
    expect(chunks.join('').replace(/\s+/gu, '')).toBe(input.replace(/\s+/gu, ''))
  })
})
