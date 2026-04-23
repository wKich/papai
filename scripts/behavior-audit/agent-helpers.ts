import { generateText } from 'ai'

import { VERBOSE } from './config.js'

type GenerateTextInput = Parameters<typeof generateText>[0]
type GenerateTextOutput = Awaited<ReturnType<typeof generateText>>

type CallbackKeys =
  | 'experimental_onStart'
  | 'experimental_onStepStart'
  | 'experimental_onToolCallStart'
  | 'experimental_onToolCallFinish'
  | 'onStepFinish'
  | 'onFinish'

const verboseCallbacks: Pick<GenerateTextInput, CallbackKeys> = {
  experimental_onStart: ({ model }) => {
    console.log(`[start] model=${model.modelId} provider=${model.provider}`)
  },
  experimental_onStepStart: ({ stepNumber }) => {
    console.log(`[step ${stepNumber}] starting`)
  },
  experimental_onToolCallStart: ({ toolCall }) => {
    const inputPreview = JSON.stringify(toolCall.input).slice(0, 200)
    console.log(`[tool ${toolCall.toolName}] start input=${inputPreview}`)
  },
  experimental_onToolCallFinish: ({ toolCall, durationMs, success, error }) => {
    const status = success ? 'ok' : `error: ${error instanceof Error ? error.message : String(error)}`
    console.log(`[tool ${toolCall.toolName}] ${status} (${durationMs}ms)`)
  },
  onStepFinish: ({ stepNumber, finishReason, usage }) => {
    console.log(`[step ${stepNumber}] finish=${finishReason} in=${usage.inputTokens} out=${usage.outputTokens}`)
  },
  onFinish: ({ totalUsage, steps }) => {
    console.log(`[done] steps=${steps.length} totalIn=${totalUsage.inputTokens} totalOut=${totalUsage.outputTokens}`)
  },
}

const noCallbacks = {} as Partial<Pick<GenerateTextInput, CallbackKeys>>

export function verboseGenerateText(input: GenerateTextInput): Promise<GenerateTextOutput> {
  const callbacks: Pick<GenerateTextInput, CallbackKeys> | Partial<Pick<GenerateTextInput, CallbackKeys>> = VERBOSE
    ? verboseCallbacks
    : noCallbacks
  return generateText({ ...input, ...callbacks })
}

export type { GenerateTextInput, GenerateTextOutput }
