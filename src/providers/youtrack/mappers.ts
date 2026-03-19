import type { YtComment, YtIssue } from '../../../schemas/youtrack/yt-types.js'
import type { Comment, RelationType, Task, TaskListItem, TaskSearchResult } from '../types.js'

const getCustomFieldValue = (issue: YtIssue, fieldName: string): string | undefined => {
  const cf = issue.customFields?.find((f) => f.name === fieldName)
  if (cf?.value === null || cf?.value === undefined) return undefined
  if (typeof cf.value !== 'object') return undefined
  return cf.value.name ?? cf.value.login
}

const mapRelationType = (linkTypeName: string, direction: string): RelationType => {
  const name = linkTypeName.toLowerCase()
  if (name === 'depend' || name === 'depends') {
    return direction === 'OUTWARD' ? 'blocks' : 'blocked_by'
  }
  if (name === 'duplicate') {
    return direction === 'OUTWARD' ? 'duplicate' : 'duplicate_of'
  }
  if (name === 'subtask') {
    return direction === 'OUTWARD' ? 'parent' : 'parent'
  }
  return 'related'
}

const toIsoOrUndefined = (timestamp: number | undefined): string | undefined =>
  timestamp === undefined ? undefined : new Date(timestamp).toISOString()

export const mapIssueToTask = (issue: YtIssue, baseUrl: string): Task => {
  const relations = (issue.links ?? []).flatMap((link) => {
    const typeName = link.linkType?.name ?? 'Relate'
    return (link.issues ?? []).map((linked) => ({
      type: mapRelationType(typeName, link.direction),
      taskId: linked.idReadable ?? linked.id,
    }))
  })

  return {
    id: issue.idReadable ?? issue.id,
    title: issue.summary,
    description: issue.description,
    status: getCustomFieldValue(issue, 'State'),
    priority: getCustomFieldValue(issue, 'Priority'),
    assignee: getCustomFieldValue(issue, 'Assignee'),
    dueDate: null,
    createdAt: toIsoOrUndefined(issue.created),
    projectId: issue.project?.id,
    url: `${baseUrl}/issue/${issue.idReadable ?? issue.id}`,
    labels: (issue.tags ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color?.background })),
    relations: relations.length > 0 ? relations : undefined,
  }
}

export const mapIssueToListItem = (issue: YtIssue): TaskListItem => ({
  id: issue.idReadable ?? issue.id,
  title: issue.summary,
  status: getCustomFieldValue(issue, 'State'),
  priority: getCustomFieldValue(issue, 'Priority'),
})

export const mapIssueToSearchResult = (issue: YtIssue): TaskSearchResult => ({
  id: issue.idReadable ?? issue.id,
  title: issue.summary,
  status: getCustomFieldValue(issue, 'State'),
  priority: getCustomFieldValue(issue, 'Priority'),
  projectId: issue.project?.id,
})

export const mapComment = (c: YtComment): Comment => ({
  id: c.id,
  body: c.text,
  author: c.author?.name ?? c.author?.login,
  createdAt: toIsoOrUndefined(c.created),
})

/** Build custom fields array for create/update requests. */
export const buildCustomFields = (params: {
  status?: string
  priority?: string
  assignee?: string
}): Array<{ name: string; $type: string; value: Record<string, string> }> => {
  const fields: Array<{ name: string; $type: string; value: Record<string, string> }> = []
  if (params.priority !== undefined) {
    fields.push({ name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { name: params.priority } })
  }
  if (params.status !== undefined) {
    fields.push({ name: 'State', $type: 'StateIssueCustomField', value: { name: params.status } })
  }
  if (params.assignee !== undefined) {
    fields.push({ name: 'Assignee', $type: 'SingleUserIssueCustomField', value: { login: params.assignee } })
  }
  return fields
}
