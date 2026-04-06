import type { AppError } from '../errors.js'

// --- Capabilities ---

/**
 * Capabilities that a task tracker provider may support.
 * Core task operations are always required; everything else is optional.
 *
 * Each domain has granular capabilities for specific operations:
 * - projects: read, list, create, update, delete
 * - comments: read, create, update, delete
 * - labels: list, create, update, delete, assign
 * - statuses: list, create, update, delete, reorder
 * - tasks: delete, relations
 */
export type Capability =
  // Tasks
  | 'tasks.delete'
  | 'tasks.relations'
  // Projects
  | 'projects.read'
  | 'projects.list'
  | 'projects.create'
  | 'projects.update'
  | 'projects.delete'
  // Comments
  | 'comments.read'
  | 'comments.create'
  | 'comments.update'
  | 'comments.delete'
  // Labels
  | 'labels.list'
  | 'labels.create'
  | 'labels.update'
  | 'labels.delete'
  | 'labels.assign'
  // Statuses
  | 'statuses.list'
  | 'statuses.create'
  | 'statuses.update'
  | 'statuses.delete'
  | 'statuses.reorder'

// --- Common domain types ---

/** Normalized task returned by all providers. */
export type Task = {
  id: string
  title: string
  description?: string | null
  status?: string
  priority?: string
  assignee?: string | null
  dueDate?: string | null
  createdAt?: string
  projectId?: string
  url: string
  labels?: TaskLabel[]
  relations?: TaskRelation[]
}

/** Minimal task representation for list results. */
export type TaskListItem = {
  id: string
  title: string
  number?: number
  status?: string
  priority?: string
  dueDate?: string | null
  url: string
}

/** Minimal task representation for search results. */
export type TaskSearchResult = {
  id: string
  title: string
  number?: number
  status?: string
  priority?: string
  projectId?: string
  url: string
}

export type Project = {
  id: string
  name: string
  description?: string | null
  url: string
}

export type Comment = {
  id: string
  body: string
  author?: string
  createdAt?: string
}

export type Label = {
  id: string
  name: string
  color?: string
}

/** Label as attached to a task (may have additional fields). */
export type TaskLabel = {
  id: string
  name: string
  color?: string
}

export type Column = {
  id: string
  name: string
  order?: number
  isFinal?: boolean
}

export type RelationType = 'blocks' | 'blocked_by' | 'duplicate' | 'duplicate_of' | 'related' | 'parent'

export type TaskRelation = {
  type: RelationType
  taskId: string
}

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

  listTasks(projectId: string): Promise<TaskListItem[]>

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
  ): Promise<Column>

  updateStatus?(
    statusId: string,
    params: { name?: string; icon?: string; color?: string; isFinal?: boolean },
  ): Promise<Column>

  deleteStatus?(statusId: string): Promise<{ id: string }>

  reorderStatuses?(projectId: string, statuses: { id: string; position: number }[]): Promise<void>

  // --- URL builders ---

  buildTaskUrl(taskId: string, projectId?: string): string

  buildProjectUrl(projectId: string): string

  // --- Error classification ---

  classifyError(error: unknown): AppError

  // --- System prompt addendum ---

  /** Returns provider-specific instructions to append to the LLM system prompt. */
  getPromptAddendum(): string
}
