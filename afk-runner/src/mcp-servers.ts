// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { AgentRoleSchema } from './config.js'

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
 * credential-bearing values — the wrong seam for either half.
 */

/**
 * Server names must be safe to embed in a tool-name prefix: OpenCode surfaces
 * a server's tools as `<name>_<tool>`, and the runner generates `"<name>_*"`
 * permission keys from the same name.
 */
const NAME_PATTERN = /^[A-Za-z0-9_-]+$/u

/**
 * The prototype-pollution name class. The alphabet admits all three, but a
 * zod record rebuild and assignment-style emission (`block[name] = entry`)
 * both silently drop `__proto__`, letting a declared server vanish without a
 * word — so they are refused over the raw parsed own keys, the one place the
 * name is still visible before a rebuild drops it.
 */
const PROTOTYPE_POLLUTION_NAMES: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

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
 * The reserved-prefix list (design D1): the on-record underscore-bearing
 * built-in tool names. A base-map name whose `<name>_*` wildcard globs one of
 * these would deny or allow a built-in tool — the non-MCP invariance broken
 * by a fully legal name — so their prefixes may not name a server. Recorded,
 * not guessed: today exactly `external_directory`
 * (`opencode-agent/src/permissions.ts`), reserving the name `external`;
 * re-record from the permissions source on an `opencode-ai` pin bump — a
 * built-in not yet on the list is the stated residual, never a silently
 * assumed absence.
 */
export const RESERVED_BUILTIN_TOOL_NAMES: readonly string[] = ['external_directory']

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
 * The refusals that name a **rule** rather than a schema path, checked before
 * the schema so the message can say what the operator did wrong rather than
 * what Zod found.
 *
 * A non-object document is left to the schema: its own refusal is the clearer
 * one, and there is no name or `oauth` to judge.
 */
const refuseUnintendable = (document: unknown): void => {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return

  for (const [name, entry] of Object.entries(document) as [string, unknown][]) {
    if (PROTOTYPE_POLLUTION_NAMES.has(name)) {
      throw new Error(
        `AGENT_MCP_SERVERS refuses the prototype-pollution server name ${JSON.stringify(name)}: a record rebuild or assignment emission silently drops it, and the declared server would vanish without a refusal`,
      )
    }
    if (!NAME_PATTERN.test(name)) {
      throw new Error(
        `AGENT_MCP_SERVERS server names must match [A-Za-z0-9_-]+ — tools arrive as <name>_<tool> and grants are keyed <name>_*: got ${JSON.stringify(name)}`,
      )
    }
    if (typeof entry === 'object' && entry !== null && Object.hasOwn(entry, 'oauth')) {
      // Refused in every spelling, not just the object one: an `oauth` value
      // of any kind can only ever express an intent an unattended run cannot
      // honour, and a silently ignored key reads as accepted.
      throw new Error(
        `AGENT_MCP_SERVERS refuses the oauth field on ${JSON.stringify(name)}: OAuth remotes park at needs_auth, and an unattended run can complete no browser flow`,
      )
    }
  }
}

const safeJson = (raw: string, knob: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`${knob} must be valid JSON`)
  }
}

/**
 * The two shadowing refusals (design D1): D4 turns every base-map name into
 * a `<name>_*` permission key, and those keys glob the binary's one flat
 * tool-name namespace — so a name may neither reach another base-map name's
 * tools (the recorded later-rule-wins ordering would let whichever key lands
 * later flip the other's verdict, whichever order they are emitted in) nor a
 * built-in tool name on record.
 */
const refuseShadowingNames = (names: readonly string[]): void => {
  for (const name of names) {
    const builtin = RESERVED_BUILTIN_TOOL_NAMES.find((tool) => tool.startsWith(`${name}_`))
    if (builtin !== undefined) {
      throw new Error(
        `AGENT_MCP_SERVERS refuses the built-in-shadowing server name ${JSON.stringify(name)}: its ${JSON.stringify(`${name}_*`)} permission wildcard would also gate the built-in tool ${JSON.stringify(builtin)}`,
      )
    }
  }
  for (const name of names) {
    const shadowed = names.find((other) => other !== name && other.startsWith(`${name}_`))
    if (shadowed !== undefined) {
      throw new Error(
        `AGENT_MCP_SERVERS refuses the shadowing server name ${JSON.stringify(name)}: its ${JSON.stringify(`${name}_*`)} permission wildcard also globs the tools of ${JSON.stringify(shadowed)} — base-map names must not be underscore-prefixes of one another`,
      )
    }
  }
}

/**
 * The role vocabulary is closed (`AgentRoleSchema`), checked over the raw
 * parsed own keys so the refusal names the key — and so a
 * prototype-pollution key like `__proto__` refuses as the unknown role it is
 * before a record rebuild can silently drop it.
 */
const refuseUnknownRoles = (document: unknown): void => {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return

  for (const role of Object.keys(document)) {
    if (!AgentRoleSchema.safeParse(role).success) {
      throw new Error(
        `AGENT_MCP_ROLE_NARROWING refuses the unknown agent role ${JSON.stringify(role)}: role keys must come from the closed vocabulary (${AgentRoleSchema.options.join(', ')})`,
      )
    }
  }
}

/**
 * Narrowing only removes (design D1): a name the base map lacks cannot be
 * shed, and honouring it would mint a server the operator never declared.
 * Validated in full whatever the base map's state — against an inactive base
 * every carried name refuses (design D5).
 */
const refuseMintedServers = (narrowing: RoleNarrowing, servers: McpServers | undefined): void => {
  for (const [role, names] of Object.entries(narrowing)) {
    for (const name of names) {
      if (servers === undefined || !Object.hasOwn(servers, name)) {
        throw new Error(
          `AGENT_MCP_ROLE_NARROWING cannot mint servers: ${JSON.stringify(name)} (shed for ${role}) is absent from the AGENT_MCP_SERVERS base map`,
        )
      }
    }
  }
}
