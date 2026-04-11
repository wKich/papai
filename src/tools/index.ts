import type { ToolSet } from 'ai'

import type { TaskProvider } from '../providers/types.js'
import { buildTools } from './tools-builder.js'
import type { MakeToolsOptions, ToolMode } from './types.js'

export type { MakeToolsOptions, ToolMode }

/**
 * Build a tool set for the given provider and context.
 *
 * Usage:
 * ```ts
 * makeTools(provider, { storageContextId: 'user-1:group-1', chatUserId: 'user-1', mode: 'normal' })
 * ```
 */
export function makeTools(provider: TaskProvider, options: MakeToolsOptions = {}): ToolSet {
  const storageContextId = options.storageContextId
  const chatUserId = options.chatUserId ?? storageContextId
  const contextId = storageContextId
  const mode = options.mode ?? 'normal'
  const contextType = options.contextType

  return buildTools(provider, chatUserId, contextId, mode, contextType)
}
