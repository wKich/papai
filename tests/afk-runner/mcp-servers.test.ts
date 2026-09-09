// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  type McpServerEntry,
  parseMcpServers,
  parseRoleNarrowing,
  RESERVED_BUILTIN_TOOL_NAMES,
} from '../../afk-runner/src/mcp-servers.js'
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

  test('refuses intra-map shadowing names, naming both names', async () => {
    // D4 emits one `<name>_*` permission key per base-map server and the
    // recorded later-rule-wins ordering lets whichever key lands later flip
    // the other's verdict, so an underscore-prefix overlap must never parse.
    const rows: readonly Row<{ readonly knob: string; readonly a: string; readonly b: string }>[] = [
      {
        label: 'foo beside foo_bar',
        knob: '{"foo":{"type":"local","command":["x"]},"foo_bar":{"type":"remote","url":"https://x.example.com"}}',
        a: 'foo',
        b: 'foo_bar',
      },
      {
        label: 'insertion order flipped — the overlap refuses either way',
        knob: '{"foo_bar":{"type":"remote","url":"https://x.example.com"},"foo":{"type":"local","command":["x"]}}',
        a: 'foo',
        b: 'foo_bar',
      },
      {
        label: 'a two-segment extension',
        knob: '{"a":{"type":"local","command":["x"]},"a_b_c":{"type":"remote","url":"https://x.example.com"}}',
        a: 'a',
        b: 'a_b_c',
      },
    ]
    await assertEach(rows, (row) => {
      expect(() => parseMcpServers(row.knob)).toThrow('AGENT_MCP_SERVERS')
      expect(() => parseMcpServers(row.knob)).toThrow('shadow')
      expect(() => parseMcpServers(row.knob)).toThrow(JSON.stringify(row.a))
      expect(() => parseMcpServers(row.knob)).toThrow(JSON.stringify(row.b))
    })
  })

  test('refuses a name whose wildcard would shadow a built-in tool, naming the name and the tool', async () => {
    // §1.2 verified content permission reaches built-ins, so `external_*`
    // would gate the recorded built-in `external_directory` — the non-MCP
    // invariance broken by a fully legal name.
    const rows: readonly Row<{ readonly knob: string; readonly name: string; readonly builtin: string }>[] = [
      {
        label: 'external, the prefix of external_directory',
        knob: '{"external":{"type":"local","command":["x"]}}',
        name: 'external',
        builtin: 'external_directory',
      },
      {
        label: 'beside other servers, still the offender',
        knob: '{"index":{"type":"remote","url":"https://x.example.com"},"external":{"type":"local","command":["x"]}}',
        name: 'external',
        builtin: 'external_directory',
      },
    ]
    await assertEach(rows, (row) => {
      expect(() => parseMcpServers(row.knob)).toThrow('AGENT_MCP_SERVERS')
      expect(() => parseMcpServers(row.knob)).toThrow('built-in')
      expect(() => parseMcpServers(row.knob)).toThrow(JSON.stringify(row.name))
      expect(() => parseMcpServers(row.knob)).toThrow(JSON.stringify(row.builtin))
    })
  })

  test('accepts names that overlap only without the underscore boundary', () => {
    const local: McpServerEntry = { type: 'local', command: ['x'] }
    const remote: McpServerEntry = { type: 'remote', url: 'https://x.example.com' }

    expect(
      parseMcpServers(
        '{"fo":{"type":"local","command":["x"]},"foo_bar":{"type":"remote","url":"https://x.example.com"}}',
      ),
    ).toEqual({ fo: local, foo_bar: remote })

    expect(
      parseMcpServers(
        '{"foo_bar":{"type":"remote","url":"https://x.example.com"},"bar":{"type":"local","command":["x"]}}',
      ),
    ).toEqual({ foo_bar: remote, bar: local })

    // The rule is a prefix rule over `<name>_*`: `extern`, and even
    // `external_directory` itself, does not glob the bare built-in tool name.
    expect(parseMcpServers('{"extern":{"type":"local","command":["x"]}}')).toEqual({ extern: local })
    expect(parseMcpServers('{"external_directory":{"type":"remote","url":"https://x.example.com"}}')).toEqual({
      external_directory: remote,
    })
  })

  test('pins the reserved built-in tool-name list to what is on record, not guessed', () => {
    // Recorded-not-guessed (design D1): `external_directory` is the only
    // underscore-bearing built-in tool name on record
    // (opencode-agent/src/permissions.ts, WRITE_TOOLS); its `external_`
    // prefix is what reserves `external` as a server name. Re-record from
    // the permissions source on an opencode-ai pin bump — a built-in not yet
    // on the list is the stated residual, never a silently assumed absence.
    expect(RESERVED_BUILTIN_TOOL_NAMES).toEqual(['external_directory'])
  })
})

/**
 * `AGENT_MCP_ROLE_NARROWING` (task 2.2): the optional per-role shed map over
 * the already-parsed base map. Role keys come from the closed
 * `AgentRoleSchema` vocabulary; every carried name must already exist in the
 * base map (narrowing cannot mint servers — validated in full whatever the
 * base map's state); blank/unset/`{}` means no narrowing.
 */
describe('parseRoleNarrowing (AGENT_MCP_ROLE_NARROWING)', () => {
  const BASE_MAP = JSON.stringify({
    work: { type: 'local', command: ['bunx', 'mcp-server-fetch@1.0.0'] },
    index: { type: 'remote', url: 'https://mcp.example.com/sse' },
  })

  test('blank, unset, and {} mean no narrowing whatever the base map state', () => {
    const servers = parseMcpServers(BASE_MAP)
    expect(parseRoleNarrowing(undefined, servers)).toBeUndefined()
    expect(parseRoleNarrowing('', servers)).toBeUndefined()
    expect(parseRoleNarrowing('   ', servers)).toBeUndefined()
    expect(parseRoleNarrowing('{}', servers)).toBeUndefined()
    expect(parseRoleNarrowing('{}', undefined)).toBeUndefined()
  })

  test("completes the spec's valid-declaration scenario: a narrowing entry over the declared base", () => {
    const servers = parseMcpServers(BASE_MAP)
    expect(parseRoleNarrowing(JSON.stringify({ reviewer: ['work'] }), servers)).toEqual({ reviewer: ['work'] })
    expect(parseRoleNarrowing(JSON.stringify({ skeptic: ['work', 'index'] }), servers)).toEqual({
      skeptic: ['work', 'index'],
    })
    // An empty shed list carries no names, so it is accepted whatever the
    // base map's state — the refusal belongs to carried names alone.
    expect(parseRoleNarrowing('{"drafter":[]}', servers)).toEqual({ drafter: [] })
    expect(parseRoleNarrowing('{"drafter":[]}', undefined)).toEqual({ drafter: [] })
  })

  test('refuses unknown role keys naming the key', async () => {
    const servers = parseMcpServers(BASE_MAP)
    const rows: readonly Row<{ readonly knob: string; readonly role: string }>[] = [
      { label: 'a role the pipeline never spawns', knob: '{"archivist":["work"]}', role: 'archivist' },
      { label: 'a case-mismatched role', knob: '{"Reviewer":["work"]}', role: 'Reviewer' },
      { label: 'a prototype-pollution name is no role either', knob: '{"__proto__":["work"]}', role: '__proto__' },
    ]
    await assertEach(rows, (row) => {
      expect(() => parseRoleNarrowing(row.knob, servers)).toThrow('AGENT_MCP_ROLE_NARROWING')
      expect(() => parseRoleNarrowing(row.knob, servers)).toThrow('role')
      expect(() => parseRoleNarrowing(row.knob, servers)).toThrow(JSON.stringify(row.role))
    })
  })

  test('refuses a shed name absent from the base map: narrowing cannot mint servers', async () => {
    // Design D5: the narrowing knob is validated in full whatever the base
    // map's state, so a carried name refuses against an inactive base too.
    const rows: readonly Row<{
      readonly baseRaw: string | undefined
      readonly knob: string
      readonly name: string
    }>[] = [
      { label: 'absent from an active base map', baseRaw: BASE_MAP, knob: '{"reviewer":["ghost"]}', name: 'ghost' },
      { label: 'against an unset base map', baseRaw: undefined, knob: '{"reviewer":["work"]}', name: 'work' },
      { label: 'against a blank base map', baseRaw: '   ', knob: '{"skeptic":["work"]}', name: 'work' },
      { label: 'against an empty {} base map', baseRaw: '{}', knob: '{"drafter":["index"]}', name: 'index' },
    ]
    await assertEach(rows, (row) => {
      const servers = parseMcpServers(row.baseRaw)
      expect(() => parseRoleNarrowing(row.knob, servers)).toThrow('AGENT_MCP_ROLE_NARROWING')
      expect(() => parseRoleNarrowing(row.knob, servers)).toThrow('mint')
      expect(() => parseRoleNarrowing(row.knob, servers)).toThrow(JSON.stringify(row.name))
    })
  })

  test('refuses malformed narrowing values naming the knob and the shape problem', async () => {
    const servers = parseMcpServers(BASE_MAP)
    const rows: readonly Row<{ readonly knob: string; readonly problem: string }>[] = [
      { label: 'not JSON at all', knob: 'not json', problem: 'JSON' },
      { label: 'a JSON array', knob: '["reviewer"]', problem: 'valid role narrowing map' },
      { label: 'a JSON scalar', knob: '"reviewer"', problem: 'valid role narrowing map' },
      { label: 'a JSON null', knob: 'null', problem: 'valid role narrowing map' },
      { label: 'a non-array shed list', knob: '{"reviewer":"work"}', problem: 'valid role narrowing map' },
      { label: 'a non-string shed name', knob: '{"reviewer":[1]}', problem: 'valid role narrowing map' },
    ]
    await assertEach(rows, (row) => {
      expect(() => parseRoleNarrowing(row.knob, servers)).toThrow('AGENT_MCP_ROLE_NARROWING')
      expect(() => parseRoleNarrowing(row.knob, servers)).toThrow(row.problem)
    })
  })
})
