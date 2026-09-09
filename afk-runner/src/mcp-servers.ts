// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/**
 * `AGENT_MCP_SERVERS` — the MCP server base map knob (afk-runner-agent-mcp
 * design D1): a JSON object mapping server names to declarations, read and
 * refused at start on the verbs that can spawn. Sibling-verbatim in shape
 * with `opencode-agent`'s same-named parse, so an operator can lift a
 * working declaration verbatim.
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

/** What one entry of the knob declares, after parsing. */
export type McpServerEntry = z.infer<typeof localSchema> | z.infer<typeof remoteSchema>

/** The base map: server name → declaration, or `undefined` when inactive. */
export type McpServers = Record<string, McpServerEntry>

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

  const document = safeJson(raw)
  refuseUnintendable(document)

  const parsed = documentSchema.safeParse(document)
  if (!parsed.success) {
    throw new Error(`AGENT_MCP_SERVERS is not a valid MCP server map: ${parsed.error.message}`)
  }
  if (Object.keys(parsed.data).length === 0) return undefined
  return parsed.data
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

const safeJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('AGENT_MCP_SERVERS must be valid JSON')
  }
}
