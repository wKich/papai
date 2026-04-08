import type { z } from 'zod'

import type { Comment, RelationType, Task, TaskListItem, TaskSearchResult } from '../types.js'
import type { CommentSchema } from './schemas/comment.js'
import type { CustomFieldValueSchema } from './schemas/custom-fields.js'
import type { IssueListSchema, IssueSchema } from './schemas/issue.js'

type AnyCustomField = z.infer<typeof CustomFieldValueSchema>

const getCustomFieldValue = (customFields: AnyCustomField[] | undefined, fieldName: string): string | undefined => {
  const cf = customFields?.find((f) => f.name === fieldName)
  if (cf === undefined) return undefined
  const val: unknown = cf.value
  if (val === null || val === undefined) return undefined
  if (typeof val === 'object') {
    const name = (val as { name?: unknown })['name']
    if (typeof name === 'string') return name
    const login = (val as { login?: unknown })['login']
    if (typeof login === 'string') return login
    return undefined
  }
  return typeof val === 'string' ? val : undefined
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

const mapReporter = (
  reporter: { id: string; login?: string; fullName?: string } | undefined,
): { id: string; login?: string; name?: string } | undefined =>
  reporter === undefined ? undefined : { id: reporter.id, login: reporter.login, name: reporter.fullName }

const mapUpdater = (
  updater: { id: string; login?: string; fullName?: string } | undefined,
): { id: string; login?: string; name?: string } | undefined =>
  updater === undefined ? undefined : { id: updater.id, login: updater.login, name: updater.fullName }

const mapParent = (
  parent: { issues: Array<{ id: string; idReadable?: string; summary: string }> } | undefined,
): { id: string; idReadable?: string; title: string } | undefined =>
  parent === undefined || parent.issues[0] === undefined
    ? undefined
    : {
        id: parent.issues[0].id,
        idReadable: parent.issues[0].idReadable,
        title: parent.issues[0].summary,
      }

const mapSubtasks = (
  subtasks: { issues: Array<{ id: string; idReadable?: string; summary: string; resolved?: number }> } | undefined,
): Array<{ id: string; idReadable?: string; title: string; status?: string }> | undefined =>
  subtasks?.issues.map((s) => ({
    id: s.id,
    idReadable: s.idReadable,
    title: s.summary,
    status: undefined,
  }))

export const mapIssueToTask = (issue: z.infer<typeof IssueSchema>, baseUrl: string): Task => {
  const relations = (issue.links ?? []).flatMap((link) => {
    const typeName = link.linkType?.name ?? 'Relate'
    return (link.issues ?? []).map((linked) => ({
      type: mapRelationType(typeName, link.direction ?? 'BOTH'),
      taskId: linked.idReadable ?? linked.id,
    }))
  })

  return {
    id: issue.idReadable ?? issue.id,
    title: issue.summary,
    description: issue.description,
    status: getCustomFieldValue(issue.customFields, 'State'),
    priority: getCustomFieldValue(issue.customFields, 'Priority'),
    assignee: getCustomFieldValue(issue.customFields, 'Assignee'),
    dueDate: null,
    createdAt: toIsoOrUndefined(issue.created),
    projectId: issue.project?.id,
    url: `${baseUrl}/issue/${issue.idReadable ?? issue.id}`,
    labels: (issue.tags ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color?.background })),
    relations: relations.length > 0 ? relations : undefined,
    number: issue.numberInProject,
    reporter: mapReporter(issue.reporter),
    updater: mapUpdater(issue.updater),
    votes: issue.votes,
    commentsCount: issue.commentsCount,
    resolved: toIsoOrUndefined(issue.resolved),
    attachments: issue.attachments,
    visibility: issue.visibility,
    parent: mapParent(issue.parent),
    subtasks: mapSubtasks(issue.subtasks),
  }
}

export const mapIssueToListItem = (issue: z.infer<typeof IssueListSchema>, baseUrl: string): TaskListItem => ({
  id: issue.idReadable ?? issue.id,
  title: issue.summary,
  number: issue.numberInProject,
  status: getCustomFieldValue(issue.customFields, 'State'),
  priority: getCustomFieldValue(issue.customFields, 'Priority'),
  resolved: toIsoOrUndefined(issue.resolved),
  url: `${baseUrl}/issue/${issue.idReadable ?? issue.id}`,
})

export const mapIssueToSearchResult = (issue: z.infer<typeof IssueListSchema>, baseUrl: string): TaskSearchResult => ({
  id: issue.idReadable ?? issue.id,
  title: issue.summary,
  status: getCustomFieldValue(issue.customFields, 'State'),
  priority: getCustomFieldValue(issue.customFields, 'Priority'),
  projectId: issue.project?.id,
  url: `${baseUrl}/issue/${issue.idReadable ?? issue.id}`,
})

export const mapComment = (c: z.infer<typeof CommentSchema>): Comment => ({
  id: c.id,
  body: c.text,
  author: c.author.name ?? c.author.login,
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
