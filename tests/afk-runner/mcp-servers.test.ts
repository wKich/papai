// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseMcpServers } from '../../afk-runner/src/mcp-servers.js'
import { assertEach, type Row } from '../utils/grouped-assertions.js'

/**
 * `AGENT_MCP_SERVERS` (task 2.1 of afk-runner-agent-mcp): the base map knob,
 * sibling-verbatim in shape with the opencode-agent parse. JSON syntax is
 * refused separately from document shape, every refusal names the knob and
 * the offending key, the prototype-pollution names are refused over the raw
 * parsed own keys before a record rebuild can silently drop them, and
 * blank/unset/`{}` is the inactive surface.
 */
describe('parseMcpServers (AGENT_MCP_SERVERS base map)', () => {
  test('blank, unset, and {} mean the inactive surface, not an error', () => {
    expect(parseMcpServers(undefined)).toBeUndefined()
    expect(parseMcpServers('')).toBeUndefined()
    expect(parseMcpServers('   ')).toBeUndefined()
    expect(parseMcpServers('{}')).toBeUndefined()
  })

  test("accepts the spec's valid-declaration base map: one local entry with command, one remote with url", () => {
    // The scenario's narrowing entry (`AGENT_MCP_ROLE_NARROWING`) joins at
    // task 2.2's knob parse; the base map here is the half this task owns.
    const servers = parseMcpServers(
      JSON.stringify({
        work: {
          type: 'local',
          command: ['bunx', 'mcp-server-fetch@1.0.0'],
          environment: { FETCH_TIMEOUT: '5000' },
        },
        index: {
          type: 'remote',
          url: 'https://mcp.example.com/sse',
          headers: { Authorization: 'Bearer tok-1234567890' },
        },
      }),
    )

    expect(servers).toEqual({
      work: {
        type: 'local',
        command: ['bunx', 'mcp-server-fetch@1.0.0'],
        environment: { FETCH_TIMEOUT: '5000' },
      },
      index: {
        type: 'remote',
        url: 'https://mcp.example.com/sse',
        headers: { Authorization: 'Bearer tok-1234567890' },
      },
    })
  })

  test('accepts both spellings with only their required fields', () => {
    const servers = parseMcpServers(
      '{"a":{"type":"local","command":["bunx","x@1"]},"b":{"type":"remote","url":"https://x.example.com"}}',
    )

    expect(servers).toEqual({
      a: { type: 'local', command: ['bunx', 'x@1'] },
      b: { type: 'remote', url: 'https://x.example.com' },
    })
  })

  test('refuses invalid JSON naming the knob and the JSON stage', async () => {
    const rows: readonly Row<{ readonly knob: string }>[] = [
      { label: 'not JSON at all', knob: 'not json' },
      { label: 'truncated JSON', knob: '{"a":' },
    ]
    await assertEach(rows, (row) => {
      expect(() => parseMcpServers(row.knob)).toThrow('AGENT_MCP_SERVERS')
      expect(() => parseMcpServers(row.knob)).toThrow('JSON')
    })
  })

  test('refuses malformed entries naming the knob and the shape problem', async () => {
    const rows: readonly Row<{ readonly knob: string }>[] = [
      { label: 'a JSON array', knob: '[{"type":"local","command":["x"]}]' },
      { label: 'a JSON scalar', knob: '"local"' },
      { label: 'no type discriminator', knob: '{"a":{"command":["x"]}}' },
      { label: 'an unknown type', knob: '{"a":{"type":"embedded","command":["x"]}}' },
      { label: 'an empty command array', knob: '{"a":{"type":"local","command":[]}}' },
      { label: 'a blank command word', knob: '{"a":{"type":"local","command":["  "]}}' },
      {
        label: 'a local entry with a url (unknown field)',
        knob: '{"a":{"type":"local","command":["x"],"url":"https://x.example.com"}}',
      },
      { label: 'a remote entry with no url', knob: '{"a":{"type":"remote"}}' },
      { label: 'an unknown field', knob: '{"a":{"type":"remote","url":"https://x.example.com","cwd":"/tmp"}}' },
      { label: 'a non-string environment value', knob: '{"a":{"type":"local","command":["x"],"environment":{"T":1}}}' },
      {
        label: 'a non-string header value',
        knob: '{"a":{"type":"remote","url":"https://x.example.com","headers":{"H":2}}}',
      },
    ]
    await assertEach(rows, (row) => {
      expect(() => parseMcpServers(row.knob)).toThrow('AGENT_MCP_SERVERS')
      expect(() => parseMcpServers(row.knob)).toThrow('valid MCP server map')
    })
  })

  test('refuses server names outside the safe alphabet, naming the name and the rule', async () => {
    const rows: readonly Row<{ readonly knob: string; readonly name: string }>[] = [
      { label: 'a space in the name', knob: '{"my server":{"type":"local","command":["x"]}}', name: 'my server' },
      { label: 'a dot in the name', knob: '{"my.server":{"type":"local","command":["x"]}}', name: 'my.server' },
      { label: 'a slash in the name', knob: '{"a/b":{"type":"remote","url":"https://x.example.com"}}', name: 'a/b' },
      { label: 'an empty name', knob: '{"":{"type":"local","command":["x"]}}', name: '' },
    ]
    await assertEach(rows, (row) => {
      expect(() => parseMcpServers(row.knob)).toThrow('AGENT_MCP_SERVERS')
      expect(() => parseMcpServers(row.knob)).toThrow('[A-Za-z0-9_-]+')
      expect(() => parseMcpServers(row.knob)).toThrow(JSON.stringify(row.name))
    })
  })

  test('refuses prototype-pollution names over the raw parsed own keys', async () => {
    // `JSON.parse` keeps `__proto__` as an own key and the alphabet admits
    // all three names; a record-schema rebuild and assignment-style emission
    // both silently drop them, so this pre-schema pass is the one place the
    // name is still visible.
    const rows: readonly Row<{ readonly knob: string; readonly name: string }>[] = [
      { label: '__proto__', knob: '{"__proto__":{"type":"local","command":["x"]}}', name: '__proto__' },
      { label: 'constructor', knob: '{"constructor":{"type":"local","command":["x"]}}', name: 'constructor' },
      { label: 'prototype', knob: '{"prototype":{"type":"remote","url":"https://x.example.com"}}', name: 'prototype' },
    ]
    await assertEach(rows, (row) => {
      expect(() => parseMcpServers(row.knob)).toThrow('AGENT_MCP_SERVERS')
      expect(() => parseMcpServers(row.knob)).toThrow('prototype-pollution')
      expect(() => parseMcpServers(row.knob)).toThrow(JSON.stringify(row.name))
    })
  })

  test('refuses an oauth key in every spelling, naming the unattended constraint', async () => {
    const rows: readonly Row<{ readonly knob: string }>[] = [
      {
        label: 'an oauth object on a remote entry',
        knob: '{"index":{"type":"remote","url":"https://x.example.com","oauth":{"clientId":"abc"}}}',
      },
      {
        label: 'oauth false on a remote entry',
        knob: '{"index":{"type":"remote","url":"https://x.example.com","oauth":false}}',
      },
      { label: 'oauth false on a local entry', knob: '{"a":{"type":"local","command":["x"],"oauth":false}}' },
    ]
    await assertEach(rows, (row) => {
      expect(() => parseMcpServers(row.knob)).toThrow('AGENT_MCP_SERVERS')
      expect(() => parseMcpServers(row.knob)).toThrow('unattended')
    })
  })
})
