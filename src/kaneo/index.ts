export { addComment } from './add-comment.js'
export { addTaskLabel } from './add-task-label.js'
export { addTaskRelation } from './add-task-relation.js'
export { archiveProject } from './archive-project.js'
export { archiveTask } from './archive-task.js'
export { createColumn } from './create-column.js'
export { createLabel } from './create-label.js'
export { createProject } from './create-project.js'
export { createTask } from './create-task.js'
export { deleteColumn } from './delete-column.js'
export { deleteTask } from './delete-task.js'
export { getComments } from './get-comments.js'
export { getTask } from './get-task.js'
export { listColumns } from './list-columns.js'
export { listLabels } from './list-labels.js'
export { listProjects } from './list-projects.js'
export { listTasks } from './list-tasks.js'
export { removeComment } from './remove-comment.js'
export { removeLabel } from './remove-label.js'
export { removeTaskLabel } from './remove-task-label.js'
export { removeTaskRelation } from './remove-task-relation.js'
export { reorderColumns } from './reorder-columns.js'
export { searchTasks } from './search-tasks.js'
export { updateColumn } from './update-column.js'
export { updateComment } from './update-comment.js'
export { updateLabel } from './update-label.js'
export { updateProject } from './update-project.js'
export { updateTask } from './update-task.js'
export { updateTaskRelation } from './update-task-relation.js'

// Error handling
export { classifyKaneoError, KaneoClassifiedError } from './classify-error.js'
export { KaneoApiError, KaneoValidationError } from './errors.js'

// Frontmatter relation handling
export {
  addRelation,
  buildDescriptionWithRelations,
  parseRelationsFromDescription,
  removeRelation,
  updateRelation,
  type TaskRelation,
} from './frontmatter.js'

// Archive label flow
export { addArchiveLabel, getOrCreateArchiveLabel, isTaskArchived } from './task-archive.js'

// High-level client
export {
  KaneoClient,
  TaskResource,
  ProjectResource,
  LabelResource,
  CommentResource,
  ColumnResource,
} from './kaneo-client.js'
