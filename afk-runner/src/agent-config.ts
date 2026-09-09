// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AgentMcpCredentials, AgentMcpSurface, McpServers } from './mcp-servers.js'

/**
 * The content composer (afk-runner-agent-mcp design D2/D3): pure functions
 * emitting the pieces of the config content afk-runner delivers to its
 * opencode children through `OPENCODE_CONFIG_CONTENT`. The emitted shape is
 * a locally-typed plain JSON object — the sibling's proven blocks copied not
 * imported (`opencode-agent/src/openai-config.ts`,
 * `opencode-agent/src/mcp-servers.ts`), because the research's
 * copy-never-import discipline bars importing the spike workspace, and the
 * SDK would buy only type-checking of an externally-owned shape across that
 * boundary. The provider block, the permission base, the `mcp` block, and
 * the whole-document serialization live here, beside the D1 size bound
 * over the serialized full-base composition.
 */

/** One provider entry of the delivered content's `provider` map. */
export interface ComposedProvider {
  readonly npm: string
  readonly name: string
  readonly options: Readonly<{ apiKey: string; baseURL: string; setCacheKey: boolean }>
  readonly models: Readonly<Record<string, Readonly<{ name: string }>>>
}

/** The `provider` map of the delivered content (design D2): provider id → entry. */
export type ComposedProviderMap = Readonly<Record<string, ComposedProvider>>

/**
 * The sibling's package pin (`opencode-agent/src/openai-config.ts`): it wins
 * over whatever package a borrowed catalogue row names in OpenCode's
 * resolution order, so one value keeps the transport `@ai-sdk/openai-compatible`
 * whatever provider id the model ref carries.
 */
const PROVIDER_NPM = '@ai-sdk/openai-compatible'

/**
 * `<provider>/<model>`, split by the sibling's `parseModelRef` rule
 * (`opencode-agent/src/sdk-contract.ts`, copied not imported): the provider
 * id is the first `/`-segment and the model id the remainder, because model
 * ids may themselves contain slashes (`openrouter/anthropic/claude-3.5`). A
 * degenerate ref — empty provider or empty model id — refuses naming the raw
 * ref rather than emitting a block keyed `""`.
 */
const parseModelRef = (raw: string): { readonly providerId: string; readonly modelId: string } => {
  const separator = raw.indexOf('/')
  if (separator <= 0 || separator === raw.length - 1) {
    throw new Error(`model ref must be "provider/model", got ${JSON.stringify(raw)}`)
  }
  return { providerId: raw.slice(0, separator), modelId: raw.slice(separator + 1) }
}

/**
 * The `provider` map of the delivered content (design D2's matrix):
 *
 * - a slash ref (`<provider>/<model…>`) with the credential pair — the
 *   sibling's proven block keyed by the provider id: `npm:
 *   '@ai-sdk/openai-compatible'`, `name: 'OpenAI-compatible'`, `options`
 *   carrying the pair's `apiKey`/`baseURL` plus `setCacheKey: true`
 *   unconditional (a provider that ignores the field is unaffected, and
 *   session-continuation spawns keep prompt-cache hits), and a `models` entry
 *   keyed by the model id — its name and nothing else, the runner holding no
 *   model facts to ride on it;
 * - a bare model (no `/`, e.g. the `opencode` default) — no provider block
 *   at all: the model resolves through the binary's own auth and catalogue,
 *   and fabricating an entry keyed to a built-in shared provider would
 *   same-key-clobber binary-owned configuration under the content-is-final
 *   precedence. The pair is inert against a bare model whatever the caller
 *   hands (`resolveAgentMcp` already warned and dropped it);
 * - a slash ref without the pair — refused: the verb-time matrix refuses
 *   that shape, so composition seeing it is drift, and half a credential
 *   pair is a contradiction on either side of the matrix.
 */
export const providerBlockFor = (
  model: string,
  credentials: AgentMcpCredentials | undefined,
): ComposedProviderMap | undefined => {
  if (!model.includes('/')) return undefined

  if (credentials === undefined) {
    throw new Error(
      `the model ref ${JSON.stringify(model)} names a provider, but the surface carries no credential pair — half a credential pair is a contradiction (LLM_API_KEY and LLM_BASE_URL must both be set)`,
    )
  }

  const { providerId, modelId } = parseModelRef(model)
  return {
    [providerId]: {
      npm: PROVIDER_NPM,
      name: 'OpenAI-compatible',
      options: {
        apiKey: credentials.apiKey,
        baseURL: credentials.baseURL,
        setCacheKey: true,
      },
      models: { [modelId]: { name: modelId } },
    },
  }
}

/** A value of the delivered `permission` map: `allow` or `deny` — `ask` is not in the emitted vocabulary. */
export type ComposedPermissionValue = 'allow' | 'deny'

/** The `permission` map of the delivered content (design D4): generated `<name>_*` key → verdict. */
export type ComposedPermissionMap = Readonly<Record<string, ComposedPermissionValue>>

/**
 * The permission base of the delivered content (design D4): exactly one
 * generated `<name>_*` key per base-map server — `"allow"` for each server
 * in the spawn's resolved set, `"deny"` for each server the role's
 * narrowing sheds. Keyed over the base map, not the resolved set, so every
 * server the operator declared is keyed allow-or-deny by construction and a
 * discovered file re-defining a shed server's name cannot re-enable it
 * (same-key conflicts resolve to the content).
 *
 * The denies-before-allows emission order is belt-and-braces, not
 * load-bearing: D1's shadowing refusals keep the emitted wildcards pairwise
 * disjoint, so under the recorded later-rule-wins ordering no key can flip
 * another key's verdict whichever order they land in — D1's built-in
 * shadowing refusal keeps every emitted key off the built-in tool names the
 * spec's non-MCP invariance protects.
 *
 * Deliberately no `"*"` key and no named built-in tool (the sibling's
 * deny-by-default shape is not copied): afk-runner's agents run on the
 * binary's default tool surface, and an allow-list would have to enumerate
 * today's built-ins exactly — a later binary's new built-in would arrive
 * silently denied, and the spec's non-MCP invariance would become
 * unpinnable. `ask` is never emitted (the `--auto` route waves it through,
 * so it gates nothing on an unattended run), and no operator-supplied
 * permission text is copied: the knob schema has no permission passthrough,
 * so the emitted keys derive from base-map server names alone.
 */
export const permissionBaseFor = (surface: AgentMcpSurface, resolved: McpServers): ComposedPermissionMap => {
  const names = Object.keys(surface.servers)
  const permission: Record<string, ComposedPermissionValue> = {}
  for (const name of names) {
    if (!Object.hasOwn(resolved, name)) permission[`${name}_*`] = 'deny'
  }
  for (const name of names) {
    if (Object.hasOwn(resolved, name)) permission[`${name}_*`] = 'allow'
  }
  return permission
}

/** A local entry of the delivered content's `mcp` map: the parsed declaration, verbatim. */
interface ComposedLocalMcpEntry {
  readonly type: 'local'
  readonly command: readonly string[]
  readonly environment?: Readonly<Record<string, string>>
}

/**
 * A remote entry of the delivered content's `mcp` map: the declaration with
 * `oauth: false` pinned by the emission itself.
 */
interface ComposedRemoteMcpEntry {
  readonly type: 'remote'
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
  readonly oauth: false
}

/** One entry of the delivered content's `mcp` map (design D3). */
export type ComposedMcpEntry = ComposedLocalMcpEntry | ComposedRemoteMcpEntry

/** The `mcp` map of the delivered content: server name → emitted entry. */
export type ComposedMcpMap = Readonly<Record<string, ComposedMcpEntry>>

/**
 * The `mcp` block of the delivered content (design D3): the spawn's resolved
 * set's entries — locals verbatim (their `environment` included), every
 * remote pinned `oauth: false`. That pin is the emission half of the rule
 * whose parse half refuses the key in every spelling (the sibling's
 * `mcpBlock`, copied not imported): parse refuses it, emission sets it, so a
 * maintainer who omitted it still gets clean `failed`-with-error degradation
 * instead of a run parked at `needs_auth` — an unattended run can complete
 * no browser flow. An empty resolved set emits no block at all: an empty
 * map contributes no entries to the overlay, and the sibling's proven
 * emission omits the key.
 *
 * Assignment-style emission is safe exactly because D1's parse refused the
 * prototype-pollution names over the raw parsed own keys — every name a
 * `block[name] = entry` write would silently drop has already refused.
 */
export const mcpBlockFor = (resolved: McpServers): ComposedMcpMap | undefined => {
  const names = Object.keys(resolved)
  if (names.length === 0) return undefined

  const block: Record<string, ComposedMcpEntry> = {}
  for (const name of names) {
    const entry = resolved[name]
    if (entry === undefined) continue
    block[name] = entry.type === 'remote' ? { ...entry, oauth: false as const } : entry
  }
  return block
}

/**
 * The whole delivered document (design D3): exactly `$schema`, `provider`
 * (the slash row only — omitted for a bare model), `model` (the same ref
 * the argv carries), `mcp` (omitted for an empty resolved set), and
 * `permission` — nothing else. No `agent` profile blocks (afk-runner's
 * spawns carry no `--agent`, and profile permission maps would change
 * built-in tool behaviour), no `small_model` (the runner holds no second
 * model), no facts the runner does not hold. The sibling's key order is
 * copied (`buildOpencodeConfig`) — order carries no semantics in the
 * overlay, but matching the proven emission keeps the two documents legible
 * side by side.
 */
export interface ComposedConfigContent {
  readonly $schema: string
  readonly provider?: ComposedProviderMap
  readonly model: string
  readonly mcp?: ComposedMcpMap
  readonly permission: ComposedPermissionMap
}

/** The sibling's schema pointer (`buildOpencodeConfig`), copied not imported. */
const CONFIG_SCHEMA = 'https://opencode.ai/config.json'

/**
 * Composes the delivered document for one resolved set — the assembly step
 * the size bound's measurement and the serialization share.
 */
const composeDocument = (model: string, surface: AgentMcpSurface, resolved: McpServers): ComposedConfigContent => {
  const provider = providerBlockFor(model, surface.credentials)
  const mcp = mcpBlockFor(resolved)
  return {
    $schema: CONFIG_SCHEMA,
    ...(provider === undefined ? {} : { provider }),
    model,
    ...(mcp === undefined ? {} : { mcp }),
    permission: permissionBaseFor(surface, resolved),
  }
}

/**
 * The Linux single-argument cap (`MAX_ARG_STRLEN`), rehomed verbatim from the
 * pruned claude-argv module — this file's size bound is its one surviving
 * consumer. The role prompt dodges the cap by riding argv, but the serialized
 * `OPENCODE_CONFIG_CONTENT` cannot — the bound refuses to compose a child env
 * that would die in `spawn` with an `E2BIG` the failure classifier would
 * misread as a dead backend.
 */
export const MAX_ARG_STRLEN = 131_072

/**
 * The D1 size bound: the serialized **full-base** composition (provider
 * block included when active) measured against the OS per-string
 * environment ceiling — `MAX_ARG_STRLEN`, rehomed into this module from
 * the pruned claude-argv module. The full base is the upper bound of every
 * per-spawn composition: narrowing only removes `mcp` entries and swaps
 * `"allow"` values for the shorter `"deny"`, so one measurement bounds
 * every spawn. An over-limit map refuses naming `AGENT_MCP_SERVERS` — the
 * alternative is an opaque `E2BIG` at the first spawn.
 */
const refuseOversizeBase = (model: string, surface: AgentMcpSurface): void => {
  const bytes = Buffer.byteLength(JSON.stringify(composeDocument(model, surface, surface.servers)), 'utf8')
  if (bytes > MAX_ARG_STRLEN) {
    throw new Error(
      `AGENT_MCP_SERVERS composes ${bytes.toLocaleString('en-US')} bytes of configuration content, over the ` +
        `${MAX_ARG_STRLEN.toLocaleString('en-US')}-byte MAX_ARG_STRLEN per-string environment ceiling, so the ` +
        'OPENCODE_CONFIG_CONTENT the child needs could not even be set — the spawn would die on an opaque ' +
        'E2BIG. Shrink the base map.',
    )
  }
}

/**
 * Composes and serializes the per-spawn content (design D3): a pure function
 * over the model ref, the resolved surface, and the spawn's resolved set —
 * the three facts the spawn seam already holds. The returned string is the
 * value of the child's `OPENCODE_CONFIG_CONTENT`: it carries credentials
 * (the provider pair, server `headers` and `environment` values) and is
 * never logged, echoed, or carried in any event payload. The D1 size bound
 * runs first, measured over the full base — the upper bound of this
 * spawn's composition whatever the role's narrowing removed.
 */
export const composeConfigContent = (model: string, surface: AgentMcpSurface, resolved: McpServers): string => {
  refuseOversizeBase(model, surface)
  return JSON.stringify(composeDocument(model, surface, resolved))
}
