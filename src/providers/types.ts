import type { AppError } from '../errors.js'
import type {
  Attachment,
  Column,
  Comment,
  CreateWorkItemParams,
  Label,
  ListTasksParams,
  Project,
  RelationType,
  Task,
  TaskListItem,
  TaskSearchResult,
  UpdateWorkItemParams,
  WorkItem,
} from './domain-types.js'

export type {
  Attachment,
  Column,
  Comment,
  CreateWorkItemParams,
  Label,
  ListTasksParams,
  Project,
  RelationType,
  Task,
  TaskLabel,
  TaskListItem,
  TaskRelation,
  TaskSearchResult,
  UpdateWorkItemParams,
  WorkItem,
} from './domain-types.js'

/** Capabilities that a task tracker provider may support. */
export type Capability =
  | 'tasks.delete'
  | 'tasks.relations'
  | 'projects.read'
  | 'projects.list'
  | 'projects.create'
  | 'projects.update'
  | 'projects.delete'
  | 'comments.read'
  | 'comments.create'
  | 'comments.update'
  | 'comments.delete'
  | 'labels.list'
  | 'labels.create'
  | 'labels.update'
  | 'labels.delete'
  | 'labels.assign'
  | 'statuses.list'
  | 'statuses.create'
  | 'statuses.update'
  | 'statuses.delete'
  | 'statuses.reorder'
  | 'attachments.list'
  | 'attachments.upload'
  | 'attachments.delete'
  | 'workItems.list'
  | 'workItems.create'
  | 'workItems.update'
  | 'workItems.delete'

// --- Provider interface ---

/** Configuration keys that a provider requires to function. */
export type ProviderConfigRequirement = {
  key: string
  label: string
  required: boolean
}

/**
 * The core interface every task tracker provider must implement.
 *
 * All core task operations are required. Optional capability methods
 * should only be present when the provider declares the matching capability.
 */
export interface TaskProvider {
  /** Provider identifier, e.g. "kaneo", "linear", "jira". */
  readonly name: string

  /** Capabilities this provider supports beyond core task CRUD. */
  readonly capabilities: ReadonlySet<Capability>

  /** Config keys this provider needs (shown in /config, validated by /setup). */
  readonly configRequirements: readonly ProviderConfigRequirement[]

  // --- Core task operations (required) ---

  createTask(params: {
    projectId: string
    title: string
    description?: string
    priority?: string
    status?: string
    dueDate?: string
    assignee?: string
  }): Promise<Task>

  getTask(taskId: string): Promise<Task>

  updateTask(
    taskId: string,
    params: {
      title?: string
      description?: string
      status?: string
      priority?: string
      dueDate?: string
      projectId?: string
      assignee?: string
    },
  ): Promise<Task>

  listTasks(projectId: string, params?: ListTasksParams): Promise<TaskListItem[]>

  searchTasks(params: { query: string; projectId?: string; limit?: number }): Promise<TaskSearchResult[]>

  // --- Optional: tasks.delete ---

  deleteTask?(taskId: string): Promise<{ id: string }>

  // --- Optional: projects.* ---

  getProject?(projectId: string): Promise<Project>

  listProjects?(): Promise<Project[]>

  createProject?(params: { name: string; description?: string }): Promise<Project>

  updateProject?(projectId: string, params: { name?: string; description?: string }): Promise<Project>

  deleteProject?(projectId: string): Promise<{ id: string }>

  // --- Optional: comments.* ---

  getComment?(taskId: string, commentId: string): Promise<Comment>

  addComment?(taskId: string, body: string): Promise<Comment>

  getComments?(taskId: string): Promise<Comment[]>

  updateComment?(params: { taskId: string; commentId: string; body: string }): Promise<Comment>

  removeComment?(params: { taskId: string; commentId: string }): Promise<{ id: string }>

  // --- Optional: labels.* ---

  listLabels?(): Promise<Label[]>

  createLabel?(params: { name: string; color?: string }): Promise<Label>

  updateLabel?(labelId: string, params: { name?: string; color?: string }): Promise<Label>

  removeLabel?(labelId: string): Promise<{ id: string }>

  addTaskLabel?(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }>

  removeTaskLabel?(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }>

  // --- Optional: tasks.relations ---

  addRelation?(
    taskId: string,
    relatedTaskId: string,
    type: RelationType,
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }>

  updateRelation?(
    taskId: string,
    relatedTaskId: string,
    type: RelationType,
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }>

  removeRelation?(taskId: string, relatedTaskId: string): Promise<{ taskId: string; relatedTaskId: string }>

  // --- Optional: statuses.* ---

  listStatuses?(projectId: string): Promise<Column[]>

  createStatus?(
    projectId: string,
    params: { name: string; icon?: string; color?: string; isFinal?: boolean },
    confirm?: boolean,
  ): Promise<Column | { status: 'confirmation_required'; message: string }>

  updateStatus?(
    projectId: string,
    statusId: string,
    params: { name?: string; icon?: string; color?: string; isFinal?: boolean },
    confirm?: boolean,
  ): Promise<Column | { status: 'confirmation_required'; message: string }>

  deleteStatus?(
    projectId: string,
    statusId: string,
    confirm?: boolean,
  ): Promise<{ id: string } | { status: 'confirmation_required'; message: string }>

  reorderStatuses?(
    projectId: string,
    statuses: { id: string; position: number }[],
    confirm?: boolean,
  ): Promise<undefined | { status: 'confirmation_required'; message: string }>

  // --- Optional: attachments.* ---

  listAttachments?(taskId: string): Promise<Attachment[]>

  uploadAttachment?(
    taskId: string,
    file: { name: string; content: Uint8Array | Blob; mimeType?: string },
  ): Promise<Attachment>

  deleteAttachment?(taskId: string, attachmentId: string): Promise<{ id: string }>

  // --- Optional: workItems.* ---

  listWorkItems?(taskId: string): Promise<WorkItem[]>

  createWorkItem?(taskId: string, params: CreateWorkItemParams): Promise<WorkItem>

  updateWorkItem?(taskId: string, workItemId: string, params: UpdateWorkItemParams): Promise<WorkItem>

  deleteWorkItem?(taskId: string, workItemId: string): Promise<{ id: string }>

  buildTaskUrl(taskId: string, projectId?: string): string

  buildProjectUrl(projectId: string): string

  classifyError(error: unknown): AppError

  /** Returns provider-specific instructions to append to the LLM system prompt. */
  getPromptAddendum(): string
}
