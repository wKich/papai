import type { ToolSet } from 'ai'

import type { TaskProvider } from '../providers/types.js'
import { makeAddCommentTool } from './add-comment.js'
import { makeAddTaskLabelTool } from './add-task-label.js'
import { makeAddTaskRelationTool } from './add-task-relation.js'
import { makeArchiveProjectTool } from './archive-project.js'
import { makeArchiveTaskTool } from './archive-task.js'
import { makeCreateColumnTool } from './create-column.js'
import { makeCreateLabelTool } from './create-label.js'
import { makeCreateProjectTool } from './create-project.js'
import { makeCreateTaskTool } from './create-task.js'
import { makeDeleteColumnTool } from './delete-column.js'
import { makeGetCommentsTool } from './get-comments.js'
import { makeGetTaskTool } from './get-task.js'
import { makeListColumnsTool } from './list-columns.js'
import { makeListLabelsTool } from './list-labels.js'
import { makeListProjectsTool } from './list-projects.js'
import { makeListTasksTool } from './list-tasks.js'
import { makeRemoveCommentTool } from './remove-comment.js'
import { makeRemoveLabelTool } from './remove-label.js'
import { makeRemoveTaskLabelTool } from './remove-task-label.js'
import { makeRemoveTaskRelationTool } from './remove-task-relation.js'
import { makeReorderColumnsTool } from './reorder-columns.js'
import { makeSearchTasksTool } from './search-tasks.js'
import { makeUpdateColumnTool } from './update-column.js'
import { makeUpdateCommentTool } from './update-comment.js'
import { makeUpdateLabelTool } from './update-label.js'
import { makeUpdateProjectTool } from './update-project.js'
import { makeUpdateTaskRelationTool } from './update-task-relation.js'
import { makeUpdateTaskTool } from './update-task.js'

export function makeTools(provider: TaskProvider): ToolSet {
  const tools: ToolSet = {
    // Core task operations — always present
    create_task: makeCreateTaskTool(provider),
    update_task: makeUpdateTaskTool(provider),
    search_tasks: makeSearchTasksTool(provider),
    list_tasks: makeListTasksTool(provider),
    get_task: makeGetTaskTool(provider),
  }

  // tasks.archive
  if (provider.capabilities.has('tasks.archive')) {
    tools['archive_task'] = makeArchiveTaskTool(provider)
  }

  // projects.crud
  if (provider.capabilities.has('projects.crud')) {
    tools['list_projects'] = makeListProjectsTool(provider)
    tools['create_project'] = makeCreateProjectTool(provider)
    tools['update_project'] = makeUpdateProjectTool(provider)
    tools['archive_project'] = makeArchiveProjectTool(provider)
  }

  // comments.crud
  if (provider.capabilities.has('comments.crud')) {
    tools['add_comment'] = makeAddCommentTool(provider)
    tools['get_comments'] = makeGetCommentsTool(provider)
    tools['update_comment'] = makeUpdateCommentTool(provider)
    tools['remove_comment'] = makeRemoveCommentTool(provider)
  }

  // labels.crud
  if (provider.capabilities.has('labels.crud')) {
    tools['list_labels'] = makeListLabelsTool(provider)
    tools['create_label'] = makeCreateLabelTool(provider)
    tools['update_label'] = makeUpdateLabelTool(provider)
    tools['remove_label'] = makeRemoveLabelTool(provider)
    tools['add_task_label'] = makeAddTaskLabelTool(provider)
    tools['remove_task_label'] = makeRemoveTaskLabelTool(provider)
  }

  // tasks.relations
  if (provider.capabilities.has('tasks.relations')) {
    tools['add_task_relation'] = makeAddTaskRelationTool(provider)
    tools['update_task_relation'] = makeUpdateTaskRelationTool(provider)
    tools['remove_task_relation'] = makeRemoveTaskRelationTool(provider)
  }

  // columns.crud
  if (provider.capabilities.has('columns.crud')) {
    tools['list_columns'] = makeListColumnsTool(provider)
    tools['create_column'] = makeCreateColumnTool(provider)
    tools['update_column'] = makeUpdateColumnTool(provider)
    tools['delete_column'] = makeDeleteColumnTool(provider)
    tools['reorder_columns'] = makeReorderColumnsTool(provider)
  }

  return tools
}
