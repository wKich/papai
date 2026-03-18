import type { ToolSet } from 'ai'

import type { TaskProvider } from '../providers/types.js'
import { makeAddCommentTool } from './add-comment.js'
import { makeAddTaskLabelTool } from './add-task-label.js'
import { makeAddTaskRelationTool } from './add-task-relation.js'
import { makeArchiveProjectTool } from './archive-project.js'
import { makeArchiveTaskTool } from './archive-task.js'
import { makeCreateLabelTool } from './create-label.js'
import { makeCreateProjectTool } from './create-project.js'
import { makeCreateStatusTool } from './create-status.js'
import { makeCreateTaskTool } from './create-task.js'
import { makeDeleteStatusTool } from './delete-status.js'
import { makeDeleteTaskTool } from './delete-task.js'
import { makeGetCommentsTool } from './get-comments.js'
import { makeGetTaskTool } from './get-task.js'
import { makeListLabelsTool } from './list-labels.js'
import { makeListProjectsTool } from './list-projects.js'
import { makeListStatusesTool } from './list-statuses.js'
import { makeListTasksTool } from './list-tasks.js'
import { makeRemoveCommentTool } from './remove-comment.js'
import { makeRemoveLabelTool } from './remove-label.js'
import { makeRemoveTaskLabelTool } from './remove-task-label.js'
import { makeRemoveTaskRelationTool } from './remove-task-relation.js'
import { makeReorderStatusesTool } from './reorder-statuses.js'
import { makeSearchTasksTool } from './search-tasks.js'
import { makeUpdateCommentTool } from './update-comment.js'
import { makeUpdateLabelTool } from './update-label.js'
import { makeUpdateProjectTool } from './update-project.js'
import { makeUpdateStatusTool } from './update-status.js'
import { makeUpdateTaskRelationTool } from './update-task-relation.js'
import { makeUpdateTaskTool } from './update-task.js'

function makeCoreTools(provider: TaskProvider): ToolSet {
  return {
    create_task: makeCreateTaskTool(provider),
    update_task: makeUpdateTaskTool(provider),
    search_tasks: makeSearchTasksTool(provider),
    list_tasks: makeListTasksTool(provider),
    get_task: makeGetTaskTool(provider),
  }
}

function maybeAddArchiveTool(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('tasks.archive')) {
    tools['archive_task'] = makeArchiveTaskTool(provider)
  }
}

function maybeAddProjectTools(tools: ToolSet, provider: TaskProvider): void {
  // Check each project capability individually
  if (provider.capabilities.has('projects.list')) {
    tools['list_projects'] = makeListProjectsTool(provider)
  }
  if (provider.capabilities.has('projects.create')) {
    tools['create_project'] = makeCreateProjectTool(provider)
  }
  if (provider.capabilities.has('projects.update')) {
    tools['update_project'] = makeUpdateProjectTool(provider)
  }
  if (provider.capabilities.has('projects.archive')) {
    tools['archive_project'] = makeArchiveProjectTool(provider)
  }
}

function maybeAddCommentTools(tools: ToolSet, provider: TaskProvider): void {
  // Check each comment capability individually
  if (provider.capabilities.has('comments.read')) {
    tools['get_comments'] = makeGetCommentsTool(provider)
  }
  if (provider.capabilities.has('comments.create')) {
    tools['add_comment'] = makeAddCommentTool(provider)
  }
  if (provider.capabilities.has('comments.update')) {
    tools['update_comment'] = makeUpdateCommentTool(provider)
  }
  if (provider.capabilities.has('comments.delete')) {
    tools['remove_comment'] = makeRemoveCommentTool(provider)
  }
}

function maybeAddLabelTools(tools: ToolSet, provider: TaskProvider): void {
  // Check each label capability individually
  if (provider.capabilities.has('labels.list')) {
    tools['list_labels'] = makeListLabelsTool(provider)
  }
  if (provider.capabilities.has('labels.create')) {
    tools['create_label'] = makeCreateLabelTool(provider)
  }
  if (provider.capabilities.has('labels.update')) {
    tools['update_label'] = makeUpdateLabelTool(provider)
  }
  if (provider.capabilities.has('labels.delete')) {
    tools['remove_label'] = makeRemoveLabelTool(provider)
  }
  if (provider.capabilities.has('labels.assign')) {
    tools['add_task_label'] = makeAddTaskLabelTool(provider)
    tools['remove_task_label'] = makeRemoveTaskLabelTool(provider)
  }
}

function maybeAddRelationTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('tasks.relations')) {
    tools['add_task_relation'] = makeAddTaskRelationTool(provider)
    tools['update_task_relation'] = makeUpdateTaskRelationTool(provider)
    tools['remove_task_relation'] = makeRemoveTaskRelationTool(provider)
  }
}

function maybeAddStatusTools(tools: ToolSet, provider: TaskProvider): void {
  // Check each status capability individually
  if (provider.capabilities.has('statuses.list')) {
    tools['list_statuses'] = makeListStatusesTool(provider)
  }
  if (provider.capabilities.has('statuses.create')) {
    tools['create_status'] = makeCreateStatusTool(provider)
  }
  if (provider.capabilities.has('statuses.update')) {
    tools['update_status'] = makeUpdateStatusTool(provider)
  }
  if (provider.capabilities.has('statuses.delete')) {
    tools['delete_status'] = makeDeleteStatusTool(provider)
  }
  if (provider.capabilities.has('statuses.reorder')) {
    tools['reorder_statuses'] = makeReorderStatusesTool(provider)
  }
}

function maybeAddDeleteTool(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('tasks.delete')) {
    tools['delete_task'] = makeDeleteTaskTool(provider)
  }
}

export function makeTools(provider: TaskProvider): ToolSet {
  const tools = makeCoreTools(provider)
  maybeAddArchiveTool(tools, provider)
  maybeAddProjectTools(tools, provider)
  maybeAddCommentTools(tools, provider)
  maybeAddLabelTools(tools, provider)
  maybeAddRelationTools(tools, provider)
  maybeAddStatusTools(tools, provider)
  maybeAddDeleteTool(tools, provider)
  return tools
}
