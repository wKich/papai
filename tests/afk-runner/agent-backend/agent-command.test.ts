// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildAgentCommand } from '../../../afk-runner/src/agent-backend/agent-command.js'

const CWD = '/repo/.review-loop/worktrees/42'

describe('buildAgentCommand (opencode branch)', () => {
  test('returns exactly today argv by full-array equality, with no stdin and no env', () => {
    const command = buildAgentCommand({
      model: 'test-model',
      cwd: CWD,
      prompt: 'review the code',
      extraArgs: [],
      label: 'reviewer',
    })

    expect(command).toEqual({
      command: 'opencode',
      args: ['run', '--auto', '--format', 'json', '--model', 'test-model', '--dir', CWD, 'review the code'],
    })
  })

  test('extraArgs ride after --dir and before the prompt, preserving order', () => {
    const command = buildAgentCommand({
      model: 'm',
      cwd: CWD,
      prompt: 'p',
      extraArgs: ['--flag-a', '--flag-b', 'value'],
      label: 'reviewer',
    })

    expect(command.args).toEqual([
      'run',
      '--auto',
      '--format',
      'json',
      '--model',
      'm',
      '--dir',
      CWD,
      '--flag-a',
      '--flag-b',
      'value',
      'p',
    ])
    expect(command.env).toBeUndefined()
  })
})

/**
 * The opencode child's replacement environment (afk-runner-agent-mcp D3): a
 * caller-composed map the builder returns verbatim — it never reads ambient
 * `process.env` — and whose absence means `realSpawn` inherits `process.env`
 * byte-identically, exactly as before the knob existed.
 */
describe('buildAgentCommand (opencodeEnv — afk-runner-agent-mcp D3)', () => {
  test('a set opencodeEnv rides verbatim as the child env beside today’s unchanged argv', () => {
    const command = buildAgentCommand({
      model: 'm',
      cwd: CWD,
      prompt: 'p',
      extraArgs: [],
      label: 'reviewer',
      opencodeEnv: {
        PATH: '/usr/bin:/bin',
        HOME: '/home/runner',
        OPENCODE_CONFIG_CONTENT: '{"mcp": {"servers": {}}}',
        LLM_API_KEY: 'llm-secret-0123456789',
      },
    })

    expect(command.args).toEqual(['run', '--auto', '--format', 'json', '--model', 'm', '--dir', CWD, 'p'])
    expect(command.env).toEqual({
      PATH: '/usr/bin:/bin',
      HOME: '/home/runner',
      OPENCODE_CONFIG_CONTENT: '{"mcp": {"servers": {}}}',
      LLM_API_KEY: 'llm-secret-0123456789',
    })
  })

  test('an absent opencodeEnv leaves no env field, so realSpawn inherits process.env byte-identically', () => {
    const command = buildAgentCommand({
      model: 'm',
      cwd: CWD,
      prompt: 'p',
      extraArgs: [],
      label: 'reviewer',
    })

    expect('env' in command).toBe(false)
  })
})

describe('buildAgentCommand (continuation id mapping — escalation-retry-session-continuation D4)', () => {
  test('opencode: a continuation id rides --session <id> after --dir and before the prompt', () => {
    const command = buildAgentCommand({
      model: 'm',
      cwd: CWD,
      prompt: 'p',
      extraArgs: [],
      label: 'reviewer',
      continueSessionId: 'ses-1',
    })
    expect(command.args).toEqual([
      'run',
      '--auto',
      '--format',
      'json',
      '--model',
      'm',
      '--dir',
      CWD,
      '--session',
      'ses-1',
      'p',
    ])
  })

  test('opencode: absent id adds no flag — argv byte-identical to today', () => {
    const command = buildAgentCommand({
      model: 'm',
      cwd: CWD,
      prompt: 'p',
      extraArgs: [],
      label: 'reviewer',
    })
    expect(command.args.includes('--session')).toBe(false)
  })
})
