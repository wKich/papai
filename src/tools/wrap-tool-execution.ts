import type { ToolExecutionOptions } from 'ai'

import { logger } from '../logger.js'
import { buildToolFailureResult } from '../tool-failure.js'

const log = logger.child({ scope: 'tool-wrapper' })

export function wrapToolExecution(
  execute: (input: unknown, options: ToolExecutionOptions) => Promise<unknown>,
  toolName: string,
): (input: unknown, options: ToolExecutionOptions) => Promise<unknown> {
  return async (input: unknown, options: ToolExecutionOptions) => {
    try {
      return await execute(input, options)
    } catch (error) {
      const failure = buildToolFailureResult(error, toolName, options.toolCallId)
      log.error(
        {
          tool: toolName,
          toolCallId: options.toolCallId,
          error: failure.error,
          errorType: failure.errorType,
          errorCode: failure.errorCode,
        },
        'Tool execution failed',
      )
      return failure
    }
  }
}
