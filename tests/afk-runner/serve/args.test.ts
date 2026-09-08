// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { parseServeArgs } from '../../../afk-runner/src/serve/args.js'

/** The serve verb's flags (spec: `serve [--host <addr>] [--port <port>] [--token <token>]`). */

describe('parseServeArgs', () => {
  it('parses no flags, each flag alone, and all three together', () => {
    expect(parseServeArgs([])).toEqual({})
    expect(parseServeArgs(['--host', '0.0.0.0'])).toEqual({ host: '0.0.0.0' })
    expect(parseServeArgs(['--port', '8080'])).toEqual({ port: 8080 })
    expect(parseServeArgs(['--token', 's3cret'])).toEqual({ token: 's3cret' })
    expect(parseServeArgs(['--host', '0.0.0.0', '--port', '8080', '--token', 's3cret'])).toEqual({
      host: '0.0.0.0',
      port: 8080,
      token: 's3cret',
    })
  })

  it('rejects a missing flag value naming the usage', () => {
    expect(() => parseServeArgs(['--host'])).toThrow(/usage: afk-runner serve/u)
    expect(() => parseServeArgs(['--port'])).toThrow(/missing value for --port/u)
    expect(() => parseServeArgs(['--token'])).toThrow(/missing value for --token/u)
  })

  it('rejects an out-of-range or non-integer port', () => {
    expect(() => parseServeArgs(['--port', 'not-a-port'])).toThrow(/invalid --port/u)
    expect(() => parseServeArgs(['--port', '-1'])).toThrow(/invalid --port/u)
    expect(() => parseServeArgs(['--port', '70000'])).toThrow(/invalid --port/u)
  })

  it('rejects unexpected tokens and flag misspellings', () => {
    expect(() => parseServeArgs(['stray'])).toThrow(/unexpected serve argument 'stray'/u)
    expect(() => parseServeArgs(['--por', '8080'])).toThrow(/unexpected serve argument '--por'/u)
  })
})
