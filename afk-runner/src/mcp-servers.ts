// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { AgentRole } from './config.js'
import {
  refuseMintedServers,
  refuseShadowingNames,
  refuseUnknownRoles,
  refuseUnintendable,
} from './mcp-server-rules.js'

export { RESERVED_BUILTIN_TOOL_NAMES } from './mcp-server-rules.js'

/**
 * `AGENT_MCP_SERVERS` — the MCP server base map knob (afk-runner-agent-mcp
 * design D1): a JSON object mapping server names to declarations, read and
 * refused at start on the verbs that can spawn. Sibling-verbatim in shape
 * with `opencode-agent`'s same-named parse, so an operator can lift a
 * working declaration verbatim. Its sibling knob `AGENT_MCP_ROLE_NARROWING`
 * (the per-role shed map over this base, design D1/D5) parses here too.
 *
 * Its own module rather than a section of `config.ts`: that file is the
 * five-key config-ladder loader, and this is env-knob seam holding
 * credential-bearing values — the wrong seam for either half. The
 * rule-naming refusals the parses lean on live in `mcp-server-rules.ts`.
 */

const localSchema = z.strictObject({
  type: z.literal('local'),
  // A word is trimmed-nonblank: a whitespace-only word is a command that can
  // never run.
  command: z.array(z.string().refine((word) => word.trim().length > 0)).min(1),
  environment: z.record(z.string(), z.string()).optional(),
})

const remoteSchema = z.strictObject({
  type: z.literal('remote'),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
})

const documentSchema = z.record(z.string(), z.union([localSchema, remoteSchema]))

const narrowingSchema = z.record(z.string(), z.array(z.string()))

/** What one entry of the knob declares, after parsing. */
export type McpServerEntry = z.infer<typeof localSchema> | z.infer<typeof remoteSchema>

/** The base map: server name → declaration, or `undefined` when inactive. */
export type McpServers = Record<string, McpServerEntry>

/** The per-role shed map: role → base-map server names to remove, or `undefined` when absent. */
export type RoleNarrowing = Readonly<Record<string, readonly string[]>>

/**
 * The credential pair of D2's slash row: the OpenAI-compatible
 * `LLM_API_KEY` + `LLM_BASE_URL` pair read from the environment — env-only,
 * never persisted, never logged; only the composed content carries it, and
 * only the child's environment carries that.
 */
export interface AgentMcpCredentials {
  readonly apiKey: string
  readonly baseURL: string
}

/**
 * The resolved operator surface (design D1/D2): the parsed base map and
 * narrowing plus the credential-pair verdict for the resolved config's model
 * ref. `undefined` is the inactive surface — no servers, no content, and no
 * credential read (inertness is absolute, D5).
 */
export interface AgentMcpSurface {
  readonly servers: McpServers
  readonly narrowing: RoleNarrowing | undefined
  readonly credentials: AgentMcpCredentials | undefined
  readonly warnings: readonly string[]
}

/**
 * Parses `AGENT_MCP_SERVERS`.
 *
 * `undefined` — unset, blank, or `{}` — is the inactive surface: no servers,
 * no content composed, every spawn behaving exactly as before the knob
 * existed. Everything else that cannot work is refused here, before any run
 * work, naming the knob and the shape problem.
 */
export const parseMcpServers = (raw: string | undefined): McpServers | undefined => {
  if (raw === undefined || raw.trim().length === 0) return undefined

  const document = safeJson(raw, 'AGENT_MCP_SERVERS')
  refuseUnintendable(document)

  const parsed = documentSchema.safeParse(document)
  if (!parsed.success) {
    throw new Error(`AGENT_MCP_SERVERS is not a valid MCP server map: ${parsed.error.message}`)
  }
  const names = Object.keys(parsed.data)
  if (names.length === 0) return undefined
  refuseShadowingNames(names)
  return parsed.data
}

/**
 * Parses `AGENT_MCP_ROLE_NARROWING` against the already-parsed base map
 * (`parseMcpServers`'s result — `undefined` for the inactive surface).
 *
 * `undefined` — unset, blank, or `{}` — means no narrowing: every role
 * carries the full base. The knob is validated in full whatever the base
 * map's state (design D5 — activation governs delivery, never validation):
 * role keys must come from the closed `AgentRoleSchema` vocabulary, and
 * every carried name must already exist in the base map, because narrowing
 * cannot mint servers.
 */
export const parseRoleNarrowing = (
  raw: string | undefined,
  servers: McpServers | undefined,
): RoleNarrowing | undefined => {
  if (raw === undefined || raw.trim().length === 0) return undefined

  const document = safeJson(raw, 'AGENT_MCP_ROLE_NARROWING')
  refuseUnknownRoles(document)

  const parsed = narrowingSchema.safeParse(document)
  if (!parsed.success) {
    throw new Error(`AGENT_MCP_ROLE_NARROWING is not a valid role narrowing map: ${parsed.error.message}`)
  }
  const narrowing: RoleNarrowing = parsed.data
  if (Object.keys(narrowing).length === 0) return undefined
  refuseMintedServers(narrowing, servers)
  return narrowing
}

/**
 * The verb-time resolution of the whole surface (design D1/D2): both knobs
 * parse-and-refuse here (the narrowing validated in full whatever the base
 * map's state, D5), then — only for an active surface — D2's
 * credential-pair matrix runs against the resolved config's model ref:
 *
 * - `<provider>/<model>` with both `LLM_API_KEY` and `LLM_BASE_URL` set —
 *   active with the pair;
 * - a slash-shaped model with either half missing — refuse naming the
 *   missing key: the delivered content must carry the provider definition,
 *   and half a credential pair is a contradiction (the review-loop claude
 *   route's both-or-neither rule);
 * - a bare model (no `/`, e.g. the `opencode` default) with any of the pair
 *   set — active with no provider facts and one warning per set key naming
 *   the ignored key (never its value), and the run proceeds: the pair names
 *   are the repo's established carriers for other tooling too, so an
 *   ambient pair beside the bare compiled default is the mainstream
 *   activation shape, not a misconfiguration;
 * - a bare model with neither set — active with no provider facts.
 *
 * The inactive surface returns `undefined` before any credential read: an
 * inactive surface never touches credentials at all.
 */
export const resolveAgentMcp = (
  env: Record<string, string | undefined>,
  model: string,
): AgentMcpSurface | undefined => {
  const servers = parseMcpServers(env['AGENT_MCP_SERVERS'])
  const narrowing = parseRoleNarrowing(env['AGENT_MCP_ROLE_NARROWING'], servers)
  if (servers === undefined) return undefined

  const apiKey = credentialOf(env, 'LLM_API_KEY')
  const baseURL = credentialOf(env, 'LLM_BASE_URL')

  if (model.includes('/')) {
    if (apiKey === undefined || baseURL === undefined) {
      const missing: string[] = []
      if (apiKey === undefined) missing.push('LLM_API_KEY')
      if (baseURL === undefined) missing.push('LLM_BASE_URL')
      throw new Error(
        `the active MCP surface delivers the provider definition for the model ${JSON.stringify(model)}, which requires both LLM_API_KEY and LLM_BASE_URL — half a credential pair is a contradiction: missing ${missing.join(', ')}`,
      )
    }
    return { servers, narrowing, credentials: { apiKey, baseURL }, warnings: [] }
  }

  const ignored: string[] = []
  if (apiKey !== undefined) ignored.push('LLM_API_KEY')
  if (baseURL !== undefined) ignored.push('LLM_BASE_URL')
  const warnings = ignored.map(
    (name) =>
      `${name} is ignored beside the bare model ${JSON.stringify(model)}: a model with no provider segment composes no provider block, so the pair is never read`,
  )
  return { servers, narrowing, credentials: undefined, warnings }
}

/**
 * The per-spawn resolved set (design D3): the base map minus the role's
 * narrowing entry, resolved at the one seam that already holds the role
 * beside `modelFor`. A role with no narrowing entry — and a surface with no
 * narrowing map at all — carries the full base as the surface's own map; an
 * empty shed list sheds nothing. Narrowing only removes (every shed name was
 * proven present in the base map at resolution, `refuseMintedServers`), so
 * this carries no refusals of its own, and a set narrowed to nothing is the
 * empty set, never an error.
 */
export const mcpFor = (surface: AgentMcpSurface, role: AgentRole): McpServers => {
  const shed = surface.narrowing?.[role]
  if (shed === undefined || shed.length === 0) return surface.servers

  const resolved: McpServers = {}
  for (const [name, entry] of Object.entries(surface.servers)) {
    if (!shed.includes(name)) resolved[name] = entry
  }
  return resolved
}

/**
 * The family's four env carriers (afk-runner-agent-mcp D3): the two knobs
 * this module parses and the credential pair `resolveAgentMcp` reads.
 * Deleted from every composed child env — a passed spawn env is the child's
 * entire replacement environment (replace-never-merge), which makes the
 * deletion free, and without it per-role narrowing would widen credential
 * exposure instead of narrowing it: the spread would hand every child the
 * whole base map's credentials, including the servers this spawn's narrowing
 * shed, plus the ambient credential pair.
 */
const AGENT_MCP_CARRIER_ENV_NAMES = [
  'AGENT_MCP_SERVERS',
  'AGENT_MCP_ROLE_NARROWING',
  'LLM_API_KEY',
  'LLM_BASE_URL',
] as const

/**
 * Composes the opencode child's entire replacement env (afk-runner-agent-mcp
 * D3): the env source's set entries with the four carriers deleted and the
 * serialized content set as `OPENCODE_CONFIG_CONTENT` — overwriting any
 * ambient value, exactly the overlay precedence the content's authority
 * requires. The returned map carries credentials (the content itself) and is
 * never logged, echoed, or carried in any event payload. Pure over its
 * inputs: the caller reads the env source only for an active surface — an
 * inactive one composes nothing and leaves spawn inheritance untouched (D5).
 */
export const composeChildEnv = (
  envSource: Record<string, string | undefined>,
  content: string,
): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(envSource)) {
    if (value !== undefined) env[name] = value
  }
  for (const name of AGENT_MCP_CARRIER_ENV_NAMES) Reflect.deleteProperty(env, name)
  env['OPENCODE_CONFIG_CONTENT'] = content
  return env
}

const safeJson = (raw: string, knob: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`${knob} must be valid JSON`)
  }
}

/**
 * A credential is set iff present and non-blank — a present-but-empty value
 * reads as unset, the same doctrine the claude route's credential selection
 * applies (CI forwards unset secrets as `''`). The value itself, when set,
 * is carried verbatim.
 */
const credentialOf = (env: Record<string, string | undefined>, name: string): string | undefined => {
  const value = env[name]
  if (value === undefined || value.trim().length === 0) return undefined
  return value
}
