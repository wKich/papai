import type { ToolSet } from 'ai'

import type { KaneoConfig } from '../kaneo/client.js'
import { makeAddCommentTool } from './add-comment.js'
import { makeAddTaskLabelTool } from './add-task-label.js'
import { makeAddTaskRelationTool } from './add-task-relation.js'
import { makeArchiveProjectTool } from './archive-project.js'
import { makeArchiveTaskTool } from './archive-task.js'
import { makeCreateLabelTool } from './create-label.js'
import { makeCreateProjectTool } from './create-project.js'
import { makeCreateTaskTool } from './create-task.js'
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
import { makeSearchTasksTool } from './search-tasks.js'
import { makeUpdateCommentTool } from './update-comment.js'
import { makeUpdateLabelTool } from './update-label.js'
import { makeUpdateProjectTool } from './update-project.js'
import { makeUpdateTaskRelationTool } from './update-task-relation.js'
import { makeUpdateTaskTool } from './update-task.js'

type ToolConfig = { kaneoConfig: KaneoConfig; workspaceId: string; projectId: string }

export function makeTools({ kaneoConfig, workspaceId, projectId }: ToolConfig): ToolSet {
  return {
    create_task: makeCreateTaskTool(kaneoConfig, projectId),
    update_task: makeUpdateTaskTool(kaneoConfig),
    search_tasks: makeSearchTasksTool(kaneoConfig, workspaceId),
    list_tasks: makeListTasksTool(kaneoConfig),
    get_task: makeGetTaskTool(kaneoConfig),
    archive_task: makeArchiveTaskTool(kaneoConfig, workspaceId),
    list_projects: makeListProjectsTool(kaneoConfig, workspaceId),
    create_project: makeCreateProjectTool(kaneoConfig, workspaceId),
    update_project: makeUpdateProjectTool(kaneoConfig),
    archive_project: makeArchiveProjectTool(kaneoConfig),
    add_comment: makeAddCommentTool(kaneoConfig),
    get_comments: makeGetCommentsTool(kaneoConfig),
    update_comment: makeUpdateCommentTool(kaneoConfig),
    remove_comment: makeRemoveCommentTool(kaneoConfig),
    list_labels: makeListLabelsTool(kaneoConfig, workspaceId),
    create_label: makeCreateLabelTool(kaneoConfig, workspaceId),
    update_label: makeUpdateLabelTool(kaneoConfig),
    remove_label: makeRemoveLabelTool(kaneoConfig),
    add_task_label: makeAddTaskLabelTool(kaneoConfig, workspaceId),
    remove_task_label: makeRemoveTaskLabelTool(kaneoConfig),
    add_task_relation: makeAddTaskRelationTool(kaneoConfig),
    update_task_relation: makeUpdateTaskRelationTool(kaneoConfig),
    remove_task_relation: makeRemoveTaskRelationTool(kaneoConfig),
    list_columns: makeListColumnsTool(kaneoConfig),
  }
}
