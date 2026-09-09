// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AgentMcpCredentials, AgentMcpSurface, McpServers } from './mcp-servers.js'

/**
 * The content composer (afk-runner-agent-mcp design D2/D3): pure functions
 * emitting the pieces of the config content afk-runner delivers to its
 * opencode children through `OPENCODE_CONFIG_CONTENT`. The emitted shape is
 * a locally-typed plain JSON object — the sibling's proven block copied not
 * imported (`opencode-agent/src/openai-config.ts`), because the research's
 * copy-never-import discipline bars importing the spike workspace, and the
 * SDK would buy only type-checking of an externally-owned shape across that
 * boundary. This file holds the provider half; the permission keys, the
 * `mcp` block, and the serialization land with their own tasks.
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
