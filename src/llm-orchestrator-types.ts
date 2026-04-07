import type { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { streamText, stepCountIs, ModelMessage, ToolSet } from 'ai'

import type { ReplyFn } from './chat/types.js'
import type { TaskProvider } from './providers/types.js'

export interface LlmOrchestratorDeps {
  streamText: typeof streamText
  stepCountIs: typeof stepCountIs
  buildOpenAI: (apiKey: string, baseURL: string) => ReturnType<typeof createOpenAICompatible>
  buildProviderForUser: {
    (userId: string, strict: false): TaskProvider | null
    (userId: string, strict: true): TaskProvider
  }
  maybeProvisionKaneo: (reply: ReplyFn, contextId: string, username: string | null) => Promise<void>
}

export type InvokeModelArgs = {
  contextId: string
  mainModel: string
  model: ReturnType<ReturnType<typeof createOpenAICompatible>>
  provider: TaskProvider
  tools: ToolSet
  messages: ModelMessage[]
  deps: LlmOrchestratorDeps
}

export type StepInput = {
  text?: string
  finishReason?: string
  toolCalls?: Array<{ toolName: string; toolCallId: string; input: unknown }>
  toolResults?: ReadonlyArray<{ toolCallId: string; output: unknown }>
  content?: ReadonlyArray<unknown>
  usage?: { inputTokens: number | undefined; outputTokens: number | undefined }
}

export type StepOutput = {
  stepNumber: number
  text?: string
  finishReason?: string
  toolCalls?: Array<{
    toolName: string
    toolCallId: string
    args: unknown
    result?: unknown
    error?: string
  }>
  usage?: { inputTokens: number | undefined; outputTokens: number | undefined }
}
