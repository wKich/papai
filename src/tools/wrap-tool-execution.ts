import type { ToolExecutionOptions } from 'ai'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool-wrapper' })

export function wrapToolExecution(
  execute: (input: unknown, options: ToolExecutionOptions) => Promise<unknown>,
  toolName: string,
): (input: unknown, options: ToolExecutionOptions) => Promise<unknown> {
  return async (input: unknown, options: ToolExecutionOptions) => {
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
