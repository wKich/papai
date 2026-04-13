import type { ToolSet } from 'ai'

import type { TaskProvider } from '../providers/types.js'
import { completionHook } from './completion-hook.js'
import { makeCreateTaskTool } from './create-task.js'
import { makeGetCurrentTimeTool } from './get-current-time.js'
import { makeGetTaskTool } from './get-task.js'
import { makeListTasksTool } from './list-tasks.js'
import { makeSearchTasksTool } from './search-tasks.js'
import { makeUpdateTaskTool } from './update-task.js'

export function makeCoreTools(provider: TaskProvider, userId?: string, storageContextId?: string): ToolSet {
  return {
    create_task: makeCreateTaskTool(provider, userId, storageContextId),
    update_task: makeUpdateTaskTool(provider, completionHook, userId, storageContextId),
    search_tasks: makeSearchTasksTool(provider, userId),
    list_tasks: makeListTasksTool(provider, userId, storageContextId),
    get_task: makeGetTaskTool(provider, userId, storageContextId),
    get_current_time: makeGetCurrentTimeTool(userId),
  }
}
