export type Attachment = {
  id: string
  name: string
  mimeType?: string
  size?: number
  url: string
  thumbnailUrl?: string
  author?: string
  createdAt?: string
}

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
  number?: number
  reporter?: { id: string; login?: string; name?: string }
  updater?: { id: string; login?: string; name?: string }
  votes?: number
  commentsCount?: number
  resolved?: string
  attachments?: Attachment[]
  visibility?: unknown
  parent?: { id: string; idReadable?: string; title: string }
  subtasks?: Array<{ id: string; idReadable?: string; title: string; status?: string }>
}

export type ListTasksParams = {
  status?: string
  priority?: 'no-priority' | 'low' | 'medium' | 'high' | 'urgent'
  assigneeId?: string
  page?: number
  limit?: number
  sortBy?: 'createdAt' | 'priority' | 'dueDate' | 'position' | 'title' | 'number'
  sortOrder?: 'asc' | 'desc'
  dueBefore?: string
  dueAfter?: string
}

/** Minimal task representation for list results. */
export type TaskListItem = {
  id: string
  title: string
  number?: number
  status?: string
  priority?: string
  dueDate?: string | null
  resolved?: string
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

/** Normalized work item (time tracking entry) returned by providers. */
export type WorkItem = {
  id: string
  taskId: string
  author: string
  /** YYYY-MM-DD */
  date: string
  /** ISO-8601 PnHnM e.g. "PT2H30M" */
  duration: string
  description?: string
  type?: string
}

export type CreateWorkItemParams = {
  /** Natural or ISO-8601 duration, e.g. "2h 30m" or "PT2H30M" */
  duration: string
  /** ISO date "YYYY-MM-DD", defaults to today */
  date?: string
  description?: string
  type?: string
  author?: string
}

export type UpdateWorkItemParams = {
  duration?: string
  date?: string
  description?: string
  type?: string
}

export type TaskRelation = {
  type: RelationType
  taskId: string
}
