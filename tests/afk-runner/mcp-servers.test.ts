// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { AgentRoleSchema, type AgentRole } from '../../afk-runner/src/config.js'
import {
  type AgentMcpSurface,
  type McpServerEntry,
  type McpServers,
  mcpFor,
  parseMcpServers,
  parseRoleNarrowing,
  RESERVED_BUILTIN_TOOL_NAMES,
  resolveAgentMcp,
} from '../../afk-runner/src/mcp-servers.js'
import { assertEach, type Row } from './grouped-assertions.js'

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

/**
 * `resolveAgentMcp` (task 2.3, design D2): the verb-time resolution of the
 * whole surface — both knobs, then the credential-pair matrix against the
 * resolved config's model ref. The pair (`LLM_API_KEY` + `LLM_BASE_URL`) is
 * read only when the surface is active: an inactive surface never touches
 * credentials at all, so inertness stays absolute (D5).
 */
describe('resolveAgentMcp (D2 credential-pair matrix)', () => {
  const SERVERS: McpServers = { work: { type: 'local', command: ['bunx', 'mcp-server-fetch@1.0.0'] } }
  const BASE_MAP = JSON.stringify(SERVERS)
  const KEY = 'sk-live-abcdef123456'
  const BASE_URL = 'https://llm.example.com/v1'

  const envOf = (extra: Record<string, string | undefined>): Record<string, string | undefined> => ({
    AGENT_MCP_SERVERS: BASE_MAP,
    ...extra,
  })

  const activeSurfaceOf = (env: Record<string, string | undefined>, model: string): AgentMcpSurface => {
    const surface = resolveAgentMcp(env, model)
    if (surface === undefined) {
      throw new Error(`expected the surface active for model ${JSON.stringify(model)}`)
    }
    return surface
  }

  const refusalOf = (env: Record<string, string | undefined>, model: string): string => {
    try {
      resolveAgentMcp(env, model)
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
    throw new Error(`expected resolveAgentMcp to refuse model ${JSON.stringify(model)}`)
  }

  /**
   * An env proxy that records every read of the credential pair's names —
   * the one observable proof an inactive resolution never touches
   * credentials (the pair must not even be read, so the values' presence
   * alone cannot stand in for the assertion).
   */
  const credentialReads: string[] = []
  const guardedEnv = (env: Record<string, string | undefined>): Record<string, string | undefined> =>
    new Proxy(env, {
      get(target: Record<string, string | undefined>, prop: string | symbol): string | undefined {
        if (prop === 'LLM_API_KEY' || prop === 'LLM_BASE_URL') {
          credentialReads.push(prop)
          return target[prop]
        }
        return typeof prop === 'string' ? target[prop] : undefined
      },
    })

  test('slash-shaped model with both halves of the pair set: active with the pair', () => {
    expect(resolveAgentMcp(envOf({ LLM_API_KEY: KEY, LLM_BASE_URL: BASE_URL }), 'ollama/llama3')).toEqual({
      servers: SERVERS,
      narrowing: undefined,
      credentials: { apiKey: KEY, baseURL: BASE_URL },
      warnings: [],
    })

    // A model id may itself contain slashes — still one slash-shaped ref
    // (the sibling's parseModelRef rule: only the first segment is the
    // provider).
    expect(
      activeSurfaceOf(envOf({ LLM_API_KEY: KEY, LLM_BASE_URL: BASE_URL }), 'openrouter/anthropic/claude-3.5')
        .credentials,
    ).toEqual({ apiKey: KEY, baseURL: BASE_URL })

    // The narrowing knob threads through the same resolution.
    expect(
      activeSurfaceOf(
        envOf({
          LLM_API_KEY: KEY,
          LLM_BASE_URL: BASE_URL,
          AGENT_MCP_ROLE_NARROWING: JSON.stringify({ reviewer: ['work'] }),
        }),
        'ollama/llama3',
      ).narrowing,
    ).toEqual({ reviewer: ['work'] })
  })

  test('slash-shaped model with either half missing refuses naming the missing key', async () => {
    const rows: readonly Row<{
      readonly env: Record<string, string | undefined>
      readonly missing: readonly string[]
    }>[] = [
      { label: 'the api key missing', env: { LLM_BASE_URL: BASE_URL }, missing: ['LLM_API_KEY'] },
      { label: 'the base url missing', env: { LLM_API_KEY: KEY }, missing: ['LLM_BASE_URL'] },
      { label: 'both halves missing', env: {}, missing: ['LLM_API_KEY', 'LLM_BASE_URL'] },
      {
        label: 'a present-but-empty api key reads as unset',
        env: { LLM_API_KEY: '', LLM_BASE_URL: BASE_URL },
        missing: ['LLM_API_KEY'],
      },
      {
        label: 'a blank base url reads as unset',
        env: { LLM_API_KEY: KEY, LLM_BASE_URL: '   ' },
        missing: ['LLM_BASE_URL'],
      },
    ]
    await assertEach(rows, (row) => {
      const message = refusalOf(envOf(row.env), 'ollama/llama3')
      expect(message).toContain('contradiction')
      // The exact missing clause pins which keys the refusal names.
      expect(message).toContain(`missing ${row.missing.join(', ')}`)
      // The refusal names keys — never the set half's value.
      expect(message).not.toContain(KEY)
      expect(message).not.toContain(BASE_URL)
    })
  })

  test('bare model with the pair set: active, no provider facts, warns naming the ignored keys — never their values', async () => {
    const rows: readonly Row<{
      readonly env: Record<string, string | undefined>
      readonly named: readonly string[]
    }>[] = [
      {
        label: 'both halves set',
        env: { LLM_API_KEY: KEY, LLM_BASE_URL: BASE_URL },
        named: ['LLM_API_KEY', 'LLM_BASE_URL'],
      },
      { label: 'only the api key set', env: { LLM_API_KEY: KEY }, named: ['LLM_API_KEY'] },
      { label: 'only the base url set', env: { LLM_BASE_URL: BASE_URL }, named: ['LLM_BASE_URL'] },
    ]
    await assertEach(rows, (row) => {
      const surface = activeSurfaceOf(envOf(row.env), 'opencode')
      expect(surface.credentials).toBeUndefined()
      expect(surface.servers).toEqual(SERVERS)
      expect(surface.warnings).toHaveLength(row.named.length)
      for (const name of row.named) {
        expect(surface.warnings.some((warning) => warning.includes(name))).toBe(true)
      }
      for (const warning of surface.warnings) {
        expect(warning).not.toContain(KEY)
        expect(warning).not.toContain(BASE_URL)
      }
    })
  })

  test('bare model with neither set: active, no provider facts, no warnings', () => {
    expect(resolveAgentMcp(envOf({}), 'opencode')).toEqual({
      servers: SERVERS,
      narrowing: undefined,
      credentials: undefined,
      warnings: [],
    })
  })

  test('an inactive surface beside a set pair reads nothing, warns on nothing', () => {
    const PAIR = { LLM_API_KEY: KEY, LLM_BASE_URL: BASE_URL }

    // Unset, blank, and {} base maps are all the inactive surface — even
    // beside a fully set pair and a slash-shaped model that would use it.
    expect(resolveAgentMcp(guardedEnv({ ...PAIR }), 'ollama/llama3')).toBeUndefined()
    expect(resolveAgentMcp(guardedEnv({ AGENT_MCP_SERVERS: '   ', ...PAIR }), 'opencode')).toBeUndefined()
    expect(resolveAgentMcp(guardedEnv({ AGENT_MCP_SERVERS: '{}', ...PAIR }), 'opencode')).toBeUndefined()
    // A present narrowing knob is validated in full whatever the base map's
    // state (D5) and still resolves inactive — an empty shed list is the one
    // shape an inactive base map accepts.
    expect(
      resolveAgentMcp(guardedEnv({ AGENT_MCP_ROLE_NARROWING: '{"drafter":[]}', ...PAIR }), 'opencode'),
    ).toBeUndefined()
    expect(credentialReads).toEqual([])
  })
})

/**
 * `mcpFor` (task 2.4, design D3): the per-spawn resolved set — the base map
 * minus the role's narrowing entry, resolved at the one seam that already
 * holds the role beside `modelFor`. A role with no narrowing entry carries
 * the full base; narrowing only removes (minting was refused at resolution),
 * so a set narrowed to nothing is the empty set, never an error.
 */
describe('mcpFor (per-spawn resolved set)', () => {
  const WORK: McpServerEntry = { type: 'local', command: ['bunx', 'mcp-server-fetch@1.0.0'] }
  const INDEX: McpServerEntry = { type: 'remote', url: 'https://mcp.example.com/sse' }
  const BASE: McpServers = { work: WORK, index: INDEX }

  const surfaceOf = (narrowingRaw: string | undefined): AgentMcpSurface => {
    const surface = resolveAgentMcp(
      { AGENT_MCP_SERVERS: JSON.stringify(BASE), AGENT_MCP_ROLE_NARROWING: narrowingRaw },
      'opencode',
    )
    if (surface === undefined) {
      throw new Error('expected the surface active beside the bare model')
    }
    return surface
  }

  test("the spec's narrowing scenario: reviewer and skeptic shed the work server, every other role keeps both", async () => {
    const surface = surfaceOf(JSON.stringify({ reviewer: ['work'], skeptic: ['work'] }))
    const rows: readonly Row<{ readonly role: AgentRole; readonly expected: McpServers }>[] = [
      { label: 'reviewer, the checking role, sheds the work server', role: 'reviewer', expected: { index: INDEX } },
      { label: 'skeptic, the checking role, sheds the work server', role: 'skeptic', expected: { index: INDEX } },
      { label: 'drafter, un-narrowed, keeps both', role: 'drafter', expected: BASE },
      { label: 'decomposer, un-narrowed, keeps both', role: 'decomposer', expected: BASE },
      { label: 'atomicity, un-narrowed, keeps both', role: 'atomicity', expected: BASE },
      {
        label: 'resolver, absent from the narrowing map, carries every base server',
        role: 'resolver',
        expected: BASE,
      },
      {
        label: 'estimator, absent from the narrowing map, carries every base server',
        role: 'estimator',
        expected: BASE,
      },
      { label: 'planner, absent from the narrowing map, carries every base server', role: 'planner', expected: BASE },
      {
        label: 'implementer, absent from the narrowing map, carries every base server',
        role: 'implementer',
        expected: BASE,
      },
    ]
    await assertEach(rows, (row) => {
      expect(mcpFor(surface, row.role)).toEqual(row.expected)
    })
    // Resolution never mutates the surface: the base map survives every
    // per-spawn resolution intact.
    expect(surface.servers).toEqual(BASE)
  })

  test('a surface with no narrowing map at all: every role in the closed vocabulary carries the full base', async () => {
    const surface = surfaceOf(undefined)
    const rows: readonly Row<{ readonly role: AgentRole }>[] = AgentRoleSchema.options.map((role) => ({
      label: `${role} carries the full base`,
      role,
    }))
    await assertEach(rows, (row) => {
      expect(mcpFor(surface, row.role)).toEqual(BASE)
    })
  })

  test('an empty shed list sheds nothing: the entry exists but removes no server', () => {
    const surface = surfaceOf('{"drafter":[]}')
    expect(mcpFor(surface, 'drafter')).toEqual(BASE)
    expect(mcpFor(surface, 'reviewer')).toEqual(BASE)
  })

  test('narrowing to nothing yields the empty set, never an error', () => {
    const surface = surfaceOf(JSON.stringify({ skeptic: ['work', 'index'] }))
    expect(mcpFor(surface, 'skeptic')).toEqual({})
    expect(mcpFor(surface, 'reviewer')).toEqual(BASE)
  })
})
