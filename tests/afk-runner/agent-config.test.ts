// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { providerBlockFor } from '../../afk-runner/src/agent-config.js'
import type { AgentMcpCredentials } from '../../afk-runner/src/mcp-servers.js'
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
