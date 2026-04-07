import type { ModelMessage, ToolSet } from 'ai'

import { emit } from './debug/event-bus.js'
import { buildStepsDetail } from './llm-orchestrator-steps.js'

// Result type after awaiting all streamText promises
export type ResolvedStreamTextResult = {
  text: string
  toolCalls: Array<{ toolName: string; toolCallId: string; input: unknown }>
  toolResults: Array<{ toolCallId: string; output: unknown }>
  steps: Array<{
    text?: string
    finishReason?: string
    toolCalls: Array<{ toolName: string; toolCallId: string; input: unknown }>
    toolResults: Array<{ toolCallId: string; output: unknown }>
    content?: ReadonlyArray<unknown>
    usage?: { inputTokens: number | undefined; outputTokens: number | undefined }
  }>
  response: { messages: ModelMessage[]; id?: string; modelId?: string }
  usage: { inputTokens: number | undefined; outputTokens: number | undefined }
  finishReason: string
  warnings?: unknown[]
  request?: unknown
  providerMetadata?: unknown
}

export function emitLlmStart(contextId: string, mainModel: string, messages: ModelMessage[], tools: ToolSet): void {
  emit('llm:start', {
    userId: contextId,
    model: mainModel,
    messageCount: messages.length,
    toolCount: Object.keys(tools).length,
  })
}

export function emitLlmEnd(
  contextId: string,
  mainModel: string,
  result: ResolvedStreamTextResult,
  startTime: number,
  messages: ModelMessage[],
  tools: ToolSet,
): void {
  emit('llm:end', {
    userId: contextId,
    model: mainModel,
    steps: result.steps.length,
    totalDuration: Date.now() - startTime,
    tokenUsage: result.usage,
    responseId: result.response?.id,
    actualModel: result.response?.modelId,
    finishReason: result.finishReason,
    messageCount: messages.length,
    toolCount: Object.keys(tools).length,
    generatedText: result.text,
    stepsDetail: buildStepsDetail(result.steps),
  })
}
