// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import type { ReplyTarget } from '../src/chat/types.js'
import type { VerifierDeps, VerifierPrompt } from '../src/completion/verified-completion.js'
import { setConfigValue } from '../src/config.js'
import { subscribe, unsubscribe, type DebugEvent } from '../src/debug/event-bus.js'
import { runRegistry } from '../src/run-control/registry.js'
import type { ToolFailureResult } from '../src/tool-failure.js'
import { assertEach, type Row } from './utils/grouped-assertions.js'
import { createTrackedLoggerMock } from './utils/logger-mock.js'
import { createMockReply, mockLogger, setupTestDb } from './utils/test-helpers.js'

const tracked = createTrackedLoggerMock()
void mock.module('../src/logger.js', () => ({ logger: tracked.logger, getLogLevel: tracked.getLogLevel }))

// src/llm-orchestrator-send.ts binds `logger.child({ scope })` at module-eval time and the
// preload graph evaluates it with the real logger, so force a fresh evaluation under the
// tracked mock with a cache-busting query (mirrors tests/history.test.ts).
type SendModule = typeof import('../src/llm-orchestrator-send.js')
const isSendModule = (value: unknown): value is SendModule =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'sendLlmResponse') === 'function'
const loadedSend: unknown = await import(`../src/llm-orchestrator-send.js?t=${crypto.randomUUID()}`)
if (!isSendModule(loadedSend)) {
  throw new Error('send module did not export expected shape')
}
const { sendLlmResponse } = loadedSend

const baseResult = {
  text: undefined as string | undefined,
  finishReason: 'stop' as string | undefined,
  toolCalls: [] as unknown[],
  finalStep: { response: { messages: [] as ModelMessage[] } },
}

const toolFailure: ToolFailureResult = {
  success: false,
  error: 'boom',
  toolName: 'update_task',
  toolCallId: 'c1',
  timestamp: '2026-09-08T00:00:00.000Z',
  errorType: 'tool-execution',
  errorCode: 'unknown',
  userMessage: 'That action failed.',
  agentMessage: 'It failed.',
  retryable: false,
}

/** A step whose tool message carries the failure above — makes the turn risky via hadToolFailure. */
type FailedToolStep = { response: { messages: ModelMessage[] } }
const failedToolStep: FailedToolStep = {
  response: {
    messages: [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'update_task',
            output: { type: 'json', value: toolFailure },
          },
        ],
      },
    ],
  },
}

beforeEach(async () => {
  await setupTestDb()
})

describe('sendLlmResponse verification wiring', () => {
  test('risky turn (empty text) invokes the verifier and delivers its text', async () => {
    mockLogger()
    const reply = createMockReply()
    let invoked = 0
    await sendLlmResponse(reply.reply, 'ctx-1', { ...baseResult }, undefined, {
      history: [],
      verifier: {
        readOnlyToolset: undefined,
        invokeVerifier: (): Promise<{ text: string | undefined }> => {
          invoked += 1
          return Promise.resolve({ text: 'Created task TK-42.' })
        },
      },
      turnId: 'turn-1',
      chatUserId: 'user-1',
    })
    expect(invoked).toBe(1)
    expect(reply.textCalls).toContain('Created task TK-42.')
  })

  test('normal turn (confident text) does NOT invoke the verifier', async () => {
    mockLogger()
    const reply = createMockReply()
    let invoked = 0
    await sendLlmResponse(reply.reply, 'ctx-1', { ...baseResult, text: 'All set — moved to Done.' }, undefined, {
      history: [],
      verifier: {
        readOnlyToolset: undefined,
        invokeVerifier: (): Promise<{ text: string | undefined }> => {
          invoked += 1
          return Promise.resolve({ text: 'should not be used' })
        },
      },
      turnId: 'turn-2',
      chatUserId: 'user-1',
    })
    expect(invoked).toBe(0)
    expect(reply.textCalls).toContain('All set — moved to Done.')
  })

  test('risky turn in a ru context gets the ru verifier prompt and no-op fallback', async () => {
    mockLogger()
    setConfigValue('ctx-ru', 'language', 'ru')
    const reply = createMockReply()
    const prompts: VerifierPrompt[] = []
    await sendLlmResponse(reply.reply, 'ctx-ru', { ...baseResult }, undefined, {
      history: [],
      verifier: {
        readOnlyToolset: undefined,
        invokeVerifier: (prompt: VerifierPrompt): Promise<{ text: string | undefined }> => {
          prompts.push(prompt)
          return Promise.resolve({ text: undefined })
        },
      },
      turnId: 'turn-3',
      chatUserId: 'user-1',
    })
    expect(prompts[0]?.system).toContain('Отвечай на русском языке')
    expect(reply.textCalls).toContain(
      'Похоже, в этот раз я ничего не выполнил — ход прервался. Пожалуйста, повтори запрос.',
    )
  })

  test('turn with executed tools gets the neutral fallback, not the no-op message', async () => {
    mockLogger()
    const reply = createMockReply()
    await sendLlmResponse(
      reply.reply,
      'ctx-1',
      {
        ...baseResult,
        steps: [
          {
            response: {
              messages: [
                {
                  role: 'tool',
                  content: [
                    {
                      type: 'tool-result',
                      toolCallId: 'c1',
                      toolName: 'get_task',
                      output: { type: 'json', value: { id: 'TK-1' } },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
      undefined,
      {
        history: [],
        verifier: {
          readOnlyToolset: undefined,
          invokeVerifier: (): Promise<{ text: string | undefined }> => Promise.resolve({ text: undefined }),
        },
        turnId: 'turn-4',
        chatUserId: 'user-1',
      },
    )
    expect(reply.textCalls).toContain(
      'I ran the requested actions but could not confirm the result — please double-check.',
    )
  })

  test('empty-text turn without a verifier in a ru context gets the localized done fallback', async () => {
    mockLogger()
    setConfigValue('ctx-ru-done', 'language', 'ru')
    const reply = createMockReply()
    await sendLlmResponse(reply.reply, 'ctx-ru-done', { ...baseResult }, undefined)
    expect(reply.textCalls).toContain('Готово.')
  })
})

describe('sendLlmResponse llm:verifier emission', () => {
  let verifierEvents: DebugEvent[]

  beforeEach(() => {
    mockLogger()
    verifierEvents = []
  })

  const captureVerifierEvents = (): (() => void) => {
    const listener = (event: DebugEvent): void => {
      if (event.type === 'llm:verifier') verifierEvents.push(event)
    }
    subscribe(listener)
    return () => unsubscribe(listener)
  }

  const modelText = 'I moved TK-42 to Done, though one label failed to apply.'
  const verifierText = 'Created task TK-42.'

  const outcomeVerifier = (mode: 'empty' | 'throw' | 'ok'): VerifierDeps => ({
    readOnlyToolset: undefined,
    invokeVerifier: (): Promise<{ text: string | undefined }> => {
      if (mode === 'throw') throw new Error('network')
      return Promise.resolve({ text: mode === 'ok' ? verifierText : '' })
    },
  })

  const outcomeResult = (mode: 'empty' | 'throw' | 'ok'): typeof baseResult & { steps?: FailedToolStep[] } =>
    mode === 'ok' ? { ...baseResult } : { ...baseResult, text: modelText, steps: [failedToolStep] }

  test('risky-turn outcome matrix: every verifier outcome emits llm:verifier carrying it', async () => {
    const rows: readonly Row<{ mode: 'empty' | 'throw' | 'ok'; expectedOutcome: string; expectedText: string }>[] = [
      {
        label: 'tool-failure turn with a blanking verifier delivers the model text and emits empty',
        mode: 'empty',
        expectedOutcome: 'empty',
        expectedText: modelText,
      },
      {
        label: 'tool-failure turn with a throwing verifier delivers the model text and emits error',
        mode: 'throw',
        expectedOutcome: 'error',
        expectedText: modelText,
      },
      {
        label: 'empty-text turn with a confirming verifier delivers the verifier text and emits ok',
        mode: 'ok',
        expectedOutcome: 'ok',
        expectedText: verifierText,
      },
    ]
    await assertEach(rows, async (row) => {
      const stop = captureVerifierEvents()
      try {
        const reply = createMockReply()
        await sendLlmResponse(reply.reply, 'ctx-emit', outcomeResult(row.mode), undefined, {
          history: [],
          verifier: outcomeVerifier(row.mode),
          turnId: 'turn-emit',
          chatUserId: 'user-emit',
        })
        expect(reply.textCalls).toContain(row.expectedText)
        expect(verifierEvents).toHaveLength(1)
        expect(verifierEvents[0]!.turnId).toBe('turn-emit')
        expect(verifierEvents[0]!.data).toEqual({ chatUserId: 'user-emit', outcome: row.expectedOutcome })
        expect(verifierEvents[0]!.scope).toEqual({ kind: 'user', userId: 'ctx-emit' })
        verifierEvents.length = 0
      } finally {
        stop()
      }
    })
  })

  test('non-risky turn with a verifier attached emits no llm:verifier and never invokes the verifier', async () => {
    const stop = captureVerifierEvents()
    try {
      let invoked = 0
      const reply = createMockReply()
      await sendLlmResponse(reply.reply, 'ctx-emit', { ...baseResult, text: 'All set — moved to Done.' }, undefined, {
        history: [],
        verifier: {
          readOnlyToolset: undefined,
          invokeVerifier: (): Promise<{ text: string | undefined }> => {
            invoked += 1
            return Promise.resolve({ text: 'should not be used' })
          },
        },
        turnId: 'turn-quiet',
        chatUserId: 'user-emit',
      })
      expect(invoked).toBe(0)
      expect(reply.textCalls).toContain('All set — moved to Done.')
      expect(verifierEvents).toHaveLength(0)
    } finally {
      stop()
    }
  })

  test('risky turn without a verifier emits no llm:verifier', async () => {
    const stop = captureVerifierEvents()
    try {
      const reply = createMockReply()
      await sendLlmResponse(reply.reply, 'ctx-emit', { ...baseResult }, undefined)
      expect(reply.textCalls).toContain('Done.')
      expect(verifierEvents).toHaveLength(0)
    } finally {
      stop()
    }
  })
})

describe('sendLlmResponse beforeFirstMessage (live-status placeholder dismissal)', () => {
  test('normal turn: placeholder is dismissed immediately before the first reply message', async () => {
    mockLogger()
    const order: string[] = []
    const reply = createMockReply()
    const formatted = reply.reply.formatted
    reply.reply.formatted = (content: string): Promise<void> => {
      order.push('reply')
      return formatted(content)
    }
    await sendLlmResponse(reply.reply, 'ctx-1', { ...baseResult, text: 'All set.' }, undefined, undefined, () => {
      order.push('dismiss')
      return Promise.resolve()
    })
    // Placeholder dismissed first, then the real answer posts — no visible gap, no lost placeholder.
    expect(order).toEqual(['dismiss', 'reply'])
    expect(reply.textCalls).toContain('All set.')
  })

  test('risky turn: placeholder survives the verification round-trip and is dismissed just before the reply', async () => {
    mockLogger()
    const order: string[] = []
    const reply = createMockReply()
    const formatted = reply.reply.formatted
    reply.reply.formatted = (content: string): Promise<void> => {
      order.push('reply')
      return formatted(content)
    }
    await sendLlmResponse(
      reply.reply,
      'ctx-1',
      { ...baseResult },
      undefined,
      {
        history: [],
        verifier: {
          readOnlyToolset: undefined,
          invokeVerifier: (): Promise<{ text: string | undefined }> => {
            order.push('verify')
            return Promise.resolve({ text: 'Created task TK-42.' })
          },
        },
        turnId: 'turn-5',
        chatUserId: 'user-1',
      },
      () => {
        order.push('dismiss')
        return Promise.resolve()
      },
    )
    // The placeholder stays up through the verifier call, then is dismissed right before the reply posts.
    expect(order).toEqual(['verify', 'dismiss', 'reply'])
    expect(reply.textCalls).toContain('Created task TK-42.')
  })
})

describe('sendLlmResponse reply-target capture', () => {
  beforeEach(() => {
    mockLogger()
    runRegistry.clear()
  })

  test('records the adapter lastReplyTarget onto the active run after posting', async () => {
    const target: ReplyTarget = { platform: 'telegram', ref: { messageId: 42, chatId: 7 } }
    const reply = createMockReply()
    reply.reply.lastReplyTarget = (): ReplyTarget | undefined => target

    runRegistry.begin('ctx-target', {
      turnId: 'turn-1',
      reply: reply.reply,
      originatingMessageIds: [],
    })

    await sendLlmResponse(reply.reply, 'ctx-target', { ...baseResult, text: 'Done.' }, undefined)

    const run = runRegistry.get('ctx-target')
    expect(run).toBeDefined()
    expect(run!.replyTarget).toBe(target)
  })

  test('leaves replyTarget undefined when the adapter exposes no lastReplyTarget', async () => {
    const reply = createMockReply()
    runRegistry.begin('ctx-no-target', {
      turnId: 'turn-2',
      reply: reply.reply,
      originatingMessageIds: [],
    })

    await sendLlmResponse(reply.reply, 'ctx-no-target', { ...baseResult, text: 'Done.' }, undefined)

    expect(runRegistry.get('ctx-no-target')!.replyTarget).toBeUndefined()
  })
})

describe('sendLlmResponse send logging', () => {
  type SendLogMeta = { sentTextLength: number; modelTextLength: number }

  const isSendLogMeta = (value: unknown): value is SendLogMeta =>
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'sentTextLength') === 'number' &&
    typeof Reflect.get(value, 'modelTextLength') === 'number'

  const findLogMeta = (level: 'info' | 'warn', message: string): SendLogMeta | undefined => {
    const call = tracked.getCallsByLevel(level).find((entry) => entry.args[1] === message)
    return call !== undefined && isSendLogMeta(call.args[0]) ? call.args[0] : undefined
  }

  beforeEach(() => {
    tracked.clearCalls()
  })

  test('send log reports the delivered length and the model text length', async () => {
    mockLogger()
    const reply = createMockReply()
    const modelText = 'All set — moved to Done.'
    await sendLlmResponse(reply.reply, 'ctx-log-1', { ...baseResult, text: modelText }, undefined)
    expect(reply.textCalls).toContain(modelText)

    const meta = findLogMeta('info', 'Response sent successfully')
    expect(meta).toBeDefined()
    expect(meta?.sentTextLength).toBe(modelText.length)
    expect(meta?.modelTextLength).toBe(modelText.length)
  })

  test('a verifier-delivered long reply logs the delivered length and a zero model text length', async () => {
    mockLogger()
    const reply = createMockReply()
    const verifierText = `Completed. ${'Details follow. '.repeat(75)}`.trimEnd()
    await sendLlmResponse(reply.reply, 'ctx-log-2', { ...baseResult }, undefined, {
      history: [],
      verifier: {
        readOnlyToolset: undefined,
        invokeVerifier: (): Promise<{ text: string | undefined }> => Promise.resolve({ text: verifierText }),
      },
      turnId: 'turn-6',
      chatUserId: 'user-1',
    })
    expect(reply.textCalls).toContain(verifierText)

    const meta = findLogMeta('info', 'Response sent successfully')
    expect(meta).toBeDefined()
    expect(meta?.sentTextLength).toBe(verifierText.length)
    expect(meta?.sentTextLength).toBeGreaterThan(1000)
    expect(meta?.modelTextLength).toBe(0)
  })

  test('the step-cap warn carries the same delivered and model text lengths', async () => {
    mockLogger()
    const reply = createMockReply()
    await sendLlmResponse(reply.reply, 'ctx-log-3', { ...baseResult, finishReason: 'tool-calls' }, undefined)

    const meta = findLogMeta(
      'warn',
      'LLM turn ended on a pending tool call (step cap reached); reply may be incomplete',
    )
    expect(meta).toBeDefined()
    expect(meta?.sentTextLength).toBe('Done.'.length)
    expect(meta?.modelTextLength).toBe(0)
  })
})
