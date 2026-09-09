// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The serve verb's flag parsing (web-board spec: `serve [--host <addr>]
 * [--port <port>] [--token <token>]`) — pinned by its own tests; the
 * front-door doc pin covers `start` flags only.
 */

export interface ServeArgs {
  readonly host?: string
  readonly port?: number
  readonly token?: string
}

const USAGE = 'usage: afk-runner serve [--host <addr>] [--port <port>] [--token <token>]'

export function parseServeArgs(args: readonly string[]): ServeArgs {
  const parsed: { host?: string; port?: number; token?: string } = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const value = args[index + 1]
    if (arg !== '--host' && arg !== '--port' && arg !== '--token') {
      throw new Error(`unexpected serve argument '${arg ?? ''}' (${USAGE})`)
    }
    if (value === undefined) throw new Error(`missing value for ${arg} (${USAGE})`)
    if (arg === '--host') parsed.host = value
    if (arg === '--token') parsed.token = value
    if (arg === '--port') {
      const port = Number(value)
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new Error(`invalid --port '${value}' (expected an integer 0–65535) (${USAGE})`)
      }
      parsed.port = port
    }
    index += 1
  }
  return parsed
}
