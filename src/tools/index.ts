import type { ToolSet } from 'ai'

import type { TaskProvider } from '../providers/types.js'
import { buildTools } from './tools-builder.js'
import type { MakeToolsOptions, ToolMode } from './types.js'
import { wrapToolExecution } from './wrap-tool-execution.js'

export type { MakeToolsOptions, ToolMode }

function wrapToolSet(tools: ToolSet): ToolSet {
  const wrapped: ToolSet = {}
  for (const [name, tool] of Object.entries(tools)) {
    if (tool === undefined || tool === null) continue
    if (tool.execute === undefined) continue
    wrapped[name] = {
      ...tool,
      execute: wrapToolExecution(tool.execute.bind(tool), name),
    }
  }
  return wrapped
}

/**
 * Build a tool set for the given provider and context.
 *
 * Usage:
 * ```ts
 * makeTools(provider, { storageContextId: 'user-1:group-1', chatUserId: 'user-1', mode: 'normal' })
 * ```
 */
export function makeTools(provider: TaskProvider, options?: MakeToolsOptions): ToolSet {
  const storageContextId = options?.storageContextId
  const chatUserId = options?.chatUserId
  const username = options?.username
  const contextId = storageContextId
  const mode = options?.mode ?? 'normal'
  const contextType = options?.contextType

  const tools = buildTools(provider, chatUserId, contextId, mode, contextType, username)
  return wrapToolSet(tools)
}
