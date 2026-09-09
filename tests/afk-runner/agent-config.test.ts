// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { type ComposedPermissionMap, permissionBaseFor, providerBlockFor } from '../../afk-runner/src/agent-config.js'
import { AgentRoleSchema, type AgentRole } from '../../afk-runner/src/config.js'
import {
  type AgentMcpCredentials,
  type AgentMcpSurface,
  type McpServerEntry,
  type McpServers,
  mcpFor,
  resolveAgentMcp,
} from '../../afk-runner/src/mcp-servers.js'
import { assertEach, type Row } from '../utils/grouped-assertions.js'

/**
 * `providerBlockFor` (task 3.1 of afk-runner-agent-mcp, design D2): the
 * `provider` map of the content afk-runner delivers to its opencode children
 * — the sibling's proven block shape copied not imported, keyed by the first
 * `/`-segment of the model ref, with the model id the remainder (which may
 * itself contain slashes). The bare-model row emits no provider block at
 * all: a bare model resolves through the binary's own auth and catalogue,
 * and fabricating an entry keyed to a built-in shared provider would
 * same-key-clobber binary-owned configuration under the content-is-final
 * precedence.
 */
describe('providerBlockFor (design D2 provider block)', () => {
  const CREDENTIALS: AgentMcpCredentials = {
    apiKey: 'sk-runner-1234567890abcdef',
    baseURL: 'https://llm.example.com/v1',
  }

  test("the slash row emits the sibling's proven block, keyed by the first /-segment", async () => {
    const rows: readonly Row<{
      readonly ref: string
      readonly providerId: string
      readonly modelId: string
    }>[] = [
      {
        label: 'a one-segment model id: the provider is the segment before the first slash',
        ref: 'kaneo/glm-4.7',
        providerId: 'kaneo',
        modelId: 'glm-4.7',
      },
      {
        label: 'a model id containing slashes: only the first segment is the provider',
        ref: 'openrouter/anthropic/claude-3.5',
        providerId: 'openrouter',
        modelId: 'anthropic/claude-3.5',
      },
    ]
    await assertEach(rows, (row) => {
      expect(providerBlockFor(row.ref, CREDENTIALS)).toEqual({
        [row.providerId]: {
          npm: '@ai-sdk/openai-compatible',
          name: 'OpenAI-compatible',
          options: {
            apiKey: CREDENTIALS.apiKey,
            baseURL: CREDENTIALS.baseURL,
            setCacheKey: true,
          },
          models: { [row.modelId]: { name: row.modelId } },
        },
      })
    })
  })

  test('the bare-model row emits no provider block at all, even beside a set pair', () => {
    // `resolveAgentMcp` already dropped the pair beside a bare model with a
    // warning, so composition sees `undefined` — but the row decision is the
    // model's own shape: a bare ref names no provider, and the pair is inert
    // against it whatever the caller hands.
    expect(providerBlockFor('opencode', undefined)).toBeUndefined()
    expect(providerBlockFor('opencode', CREDENTIALS)).toBeUndefined()
  })

  test('degenerate slash refs refuse naming the raw ref (the sibling parseModelRef rule)', () => {
    expect(() => providerBlockFor('/glm-4.7', CREDENTIALS)).toThrow('/glm-4.7')
    expect(() => providerBlockFor('kaneo/', CREDENTIALS)).toThrow('kaneo/')
    expect(() => providerBlockFor('/', CREDENTIALS)).toThrow()
  })

  test('a slash ref with no credential pair refuses: half a pair is a contradiction', () => {
    // The verb-time matrix refuses this shape, so composition seeing it is
    // drift — refuse rather than emit a block whose options carry undefined
    // credentials (the first-spawn ProviderModelNotFoundError the matrix
    // exists to prevent, caught one layer later).
    expect(() => providerBlockFor('kaneo/glm-4.7', undefined)).toThrow('LLM_API_KEY')
    expect(() => providerBlockFor('kaneo/glm-4.7', undefined)).toThrow('LLM_BASE_URL')
  })
})

/**
 * `permissionBaseFor` (task 3.2 of afk-runner-agent-mcp, design D4): the
 * `permission` map of the delivered content — exactly one generated
 * `<name>_*` key per base-map server, `"allow"` for each server in the
 * spawn's resolved set and `"deny"` for each server the role's narrowing
 * sheds, denies emitted before allows (belt-and-braces: D1's shadowing
 * refusals keep the emitted wildcards pairwise disjoint, so no emission
 * order can flip another key's verdict). No `"*"` key, no built-in tool
 * names, `ask` never emitted, no operator-supplied permission text copied —
 * the knob schema has no permission passthrough.
 */
describe('permissionBaseFor (design D4 permission base)', () => {
  const WORK: McpServerEntry = { type: 'local', command: ['bunx', 'mcp-server-fetch@1.0.0'] }
  const INDEX: McpServerEntry = { type: 'remote', url: 'https://mcp.example.com/sse' }
  const NOTES: McpServerEntry = { type: 'local', command: ['bunx', 'mcp-server-notes@2.0.0'] }
  const BASE: McpServers = { work: WORK, index: INDEX, notes: NOTES }

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

  // The composition seam D3 names: the spawn's resolved set from `mcpFor`,
  // the permission base keyed over the surface's base map.
  const permissionFor = (surface: AgentMcpSurface, role: AgentRole): ComposedPermissionMap =>
    permissionBaseFor(surface, mcpFor(surface, role))

  test('granted/shed composition: allow for the resolved set, deny for what the narrowing sheds', async () => {
    const surface = surfaceOf(JSON.stringify({ reviewer: ['work', 'notes'], skeptic: ['work', 'index', 'notes'] }))
    const rows: readonly Row<{
      readonly role: AgentRole
      readonly expected: Record<string, 'allow' | 'deny'>
      readonly order: readonly string[]
    }>[] = [
      {
        label: 'reviewer sheds work and notes: denies for both, allow for index, denies emitted before allows',
        role: 'reviewer',
        expected: { 'work_*': 'deny', 'notes_*': 'deny', 'index_*': 'allow' },
        // Base-map order is work, index, notes — the deny keys landing
        // before the allow key is the emission order, not the base's.
        order: ['work_*', 'notes_*', 'index_*'],
      },
      {
        label: 'skeptic sheds every server: all denies, nothing allowed',
        role: 'skeptic',
        expected: { 'work_*': 'deny', 'index_*': 'deny', 'notes_*': 'deny' },
        order: ['work_*', 'index_*', 'notes_*'],
      },
      {
        label: 'drafter, no narrowing entry: every base server allowed',
        role: 'drafter',
        expected: { 'work_*': 'allow', 'index_*': 'allow', 'notes_*': 'allow' },
        order: ['work_*', 'index_*', 'notes_*'],
      },
    ]
    await assertEach(rows, (row) => {
      const permission = permissionFor(surface, row.role)
      expect(permission).toEqual(row.expected)
      // Key order pins the denies-before-allows emission: one key per
      // base-map server, denies first in base order, then allows.
      expect(Object.keys(permission)).toEqual([...row.order])
    })
    // Resolution never mutates the surface: the base map survives the
    // per-spawn composition intact.
    expect(surface.servers).toEqual(BASE)
  })

  test('a surface with no narrowing map at all: every role in the closed vocabulary carries an all-allow base', async () => {
    const surface = surfaceOf(undefined)
    const rows: readonly Row<{ readonly role: AgentRole }>[] = AgentRoleSchema.options.map((role) => ({
      label: `${role} carries the full allow base`,
      role,
    }))
    await assertEach(rows, (row) => {
      expect(permissionFor(surface, row.role)).toEqual({
        'work_*': 'allow',
        'index_*': 'allow',
        'notes_*': 'allow',
      })
    })
  })

  test("inspection: no ask value, no key outside the base map's generated wildcards", async () => {
    const narrowed = surfaceOf(JSON.stringify({ reviewer: ['work', 'notes'], drafter: ['index'] }))
    const plain = surfaceOf(undefined)
    const rows: readonly Row<{ readonly permission: ComposedPermissionMap }>[] = [
      { label: 'a shed-heavy composition (reviewer)', permission: permissionFor(narrowed, 'reviewer') },
      { label: 'a one-server shed (drafter)', permission: permissionFor(narrowed, 'drafter') },
      { label: 'an un-narrowed role beside narrowed ones (skeptic)', permission: permissionFor(narrowed, 'skeptic') },
      {
        label: 'a surface with no narrowing map at all',
        permission: permissionFor(plain, 'implementer'),
      },
    ]
    // The base map's generated wildcards — the complete legal key set. No
    // `"*"` key, no built-in tool name, and no operator permission text can
    // be a member of it (and the knob schema has no permission passthrough
    // to copy from in the first place).
    const wildcards = new Set(Object.keys(BASE).map((name) => `${name}_*`))
    await assertEach(rows, (row) => {
      // `ask` never emitted: the spawn route auto-approves what is not
      // explicitly denied, so it gates nothing on an unattended run. The
      // scan is deliberately runtime-blind — a string view of the values,
      // not the `'allow' | 'deny'` type that already forbids `ask`.
      expect((Object.values(row.permission) as string[]).includes('ask')).toBe(false)
      for (const key of Object.keys(row.permission)) {
        expect(wildcards.has(key)).toBe(true)
      }
      // Exactly one key per base-map server: the map covers the base and
      // nothing else.
      expect(Object.keys(row.permission).length).toBe(wildcards.size)
      expect(Object.hasOwn(row.permission, '*')).toBe(false)
    })
  })
})
