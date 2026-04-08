import type { ModelMessage, ToolSet } from 'ai'

import { emit } from './debug/event-bus.js'
import { buildStepsDetail } from './llm-orchestrator-steps.js'
import type { StepInput } from './llm-orchestrator-types.js'

export type LlmResult = {
  text: string
  steps: StepInput[]
  response?: { id?: string; modelId?: string }
  usage?: { inputTokens?: number; outputTokens?: number }
  finishReason?: string
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
  result: LlmResult,
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
