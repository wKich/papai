import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool-wrapper' })

export interface ToolExecutionOptions {
  toolCallId: string
  messages: unknown[]
  abortSignal?: AbortSignal
}

export interface ToolErrorResult {
  success: false
  error: string
  toolName: string
  toolCallId: string
  timestamp: string
}

export type ToolExecuteFunction<TInput, TOutput> = (input: TInput, options: ToolExecutionOptions) => Promise<TOutput>

export type WrappedToolExecuteFunction<TInput, TOutput> = (
  input: TInput,
  options: ToolExecutionOptions,
) => Promise<TOutput | ToolErrorResult>

export function wrapToolExecution<TInput, TOutput>(
  execute: ToolExecuteFunction<TInput, TOutput>,
  toolName: string,
): WrappedToolExecuteFunction<TInput, TOutput> {
  return async (input: TInput, options: ToolExecutionOptions): Promise<TOutput | ToolErrorResult> => {
    try {
      return await execute(input, options)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error({ tool: toolName, toolCallId: options.toolCallId, error: errorMessage }, 'Tool execution failed')
      return {
        success: false,
        error: errorMessage,
        toolName,
        toolCallId: options.toolCallId,
        timestamp: new Date().toISOString(),
      }
    }
  }
}
