import type { z } from 'zod'

import type {
  Attachment,
  Comment,
  CommentReaction,
  RelationType,
  Task,
  TaskCustomField,
  TaskListItem,
  TaskSearchResult,
  TaskVisibility,
  UserRef,
  VisibilityGroupRef,
} from '../types.js'
import { YOUTRACK_DUE_DATE_FIELD_NAME } from './constants.js'
import { mapYouTrackDueDateValue } from './due-date.js'
import type { CommentSchema } from './schemas/comment.js'
import type { CustomFieldValueSchema } from './schemas/custom-fields.js'
import type { IssueListSchema, IssueSchema } from './schemas/issue.js'
import type { ReactionSchema } from './schemas/reaction.js'
import type { VisibilitySchema } from './schemas/visibility.js'

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
    return direction === 'OUTWARD' ? 'parent' : 'child'
  }
  return 'related'
}

const toIsoOrUndefined = (timestamp: number | null | undefined): string | undefined =>
  timestamp === undefined || timestamp === null ? undefined : new Date(timestamp).toISOString()

const toDateOnlyOrUndefined = mapYouTrackDueDateValue

const getCustomFieldTimestamp = (customFields: AnyCustomField[] | undefined, fieldName: string): number | undefined => {
  const cf = customFields?.find((field) => field.name === fieldName)
  if (cf === undefined) return undefined
  return typeof cf.value === 'number' ? cf.value : undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const getStringProperty = (value: unknown, property: 'login' | 'name' | 'text'): string | undefined => {
  if (!isRecord(value)) return undefined
  const prop = value[property]
  return typeof prop === 'string' ? prop : undefined
}

const stringifyUnknownValue = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? '[complex value]'
  } catch {
    return '[complex value]'
  }
}

const buildReadOnlyCustomFieldValue = (value: unknown): string | number | boolean | string[] | null => {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  const textValue = getStringProperty(value, 'text')
  if (textValue !== undefined) return textValue
  const nameValue = getStringProperty(value, 'name')
  if (nameValue !== undefined) return nameValue
  const loginValue = getStringProperty(value, 'login')
  if (loginValue !== undefined) return loginValue
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item === null || item === undefined) return undefined
        return typeof item === 'string' ? item : (getStringProperty(item, 'name') ?? getStringProperty(item, 'login'))
      })
      .filter((item): item is string => item !== undefined)
  }
  return stringifyUnknownValue(value)
}

const mapReadOnlyCustomFields = (customFields: AnyCustomField[] | undefined): TaskCustomField[] | undefined => {
  const mapped = (customFields ?? [])
    .filter((field) => !['State', 'Priority', 'Assignee', YOUTRACK_DUE_DATE_FIELD_NAME].includes(field.name))
    .map((field) => ({ name: field.name, value: buildReadOnlyCustomFieldValue(field.value) }))

  return mapped.length === 0 ? undefined : mapped
}

export const mapUserRef = (
  user: { id: string; login?: string; fullName?: string; name?: string } | undefined,
): UserRef | undefined =>
  user === undefined
    ? undefined
    : {
        id: user.id,
        login: user.login,
        name: user.fullName ?? user.name,
      }

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
  subtasks:
    | { issues: Array<{ id: string; idReadable?: string; summary: string; resolved?: number | null | undefined }> }
    | undefined,
): Array<{ id: string; idReadable?: string; title: string; status?: string }> | undefined =>
  subtasks?.issues.map((s) => ({
    id: s.id,
    idReadable: s.idReadable,
    title: s.summary,
    status: s.resolved === undefined || s.resolved === null ? 'open' : 'resolved',
  }))

const mapVisibilityGroups = (
  groups: Array<{ id: string; name: string }> | undefined,
): VisibilityGroupRef[] | undefined =>
  groups === undefined || groups.length === 0 ? undefined : groups.map((group) => ({ id: group.id, name: group.name }))

export const mapTaskVisibility = (
  visibility: z.infer<typeof VisibilitySchema> | undefined,
): TaskVisibility | undefined => {
  if (visibility === undefined) return undefined
  if (visibility.$type === 'UnlimitedVisibility') {
    return { kind: 'public' }
  }

  const users = visibility.permittedUsers?.map(mapUserRef).filter((user): user is UserRef => user !== undefined)
  const groups = mapVisibilityGroups(visibility.permittedGroups)
  return {
    kind: 'restricted',
    users: users === undefined || users.length === 0 ? undefined : users,
    groups,
  }
}

export const mapCommentReaction = (reaction: z.infer<typeof ReactionSchema>): CommentReaction => ({
  id: reaction.id,
  reaction: reaction.reaction,
  author: mapUserRef(reaction.author),
  createdAt: undefined,
})

export const mapYouTrackWatchers = (
  watchers: z.infer<typeof IssueSchema>['watchers'] | undefined,
): UserRef[] | undefined => {
  const mapped = watchers?.issueWatchers
    ?.map((watcher) => mapUserRef(watcher.user))
    .filter((watcher): watcher is UserRef => watcher !== undefined)

  return mapped === undefined || mapped.length === 0 ? undefined : mapped
}

export const mapAttachment = (a: {
  id: string
  name: string
  url?: string
  mimeType?: string
  size?: number
  thumbnailURL?: string
  author?: { login?: string }
  created?: number
}): Attachment => ({
  id: a.id,
  name: a.name,
  url: a.url ?? '',
  mimeType: a.mimeType,
  size: a.size,
  thumbnailUrl: a.thumbnailURL,
  author: a.author?.login,
  createdAt: toIsoOrUndefined(a.created),
})

const mapAttachments = (
  attachments:
    | Array<{
        id: string
        name: string
        url?: string
        mimeType?: string
        size?: number
        thumbnailURL?: string
        author?: { login?: string }
        created?: number
      }>
    | undefined,
): Attachment[] | undefined =>
  attachments === undefined || attachments.length === 0 ? undefined : attachments.map(mapAttachment)

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
    dueDate: toDateOnlyOrUndefined(getCustomFieldTimestamp(issue.customFields, YOUTRACK_DUE_DATE_FIELD_NAME)) ?? null,
    createdAt: toIsoOrUndefined(issue.created),
    projectId: issue.project?.id,
    url: `${baseUrl}/issue/${issue.idReadable ?? issue.id}`,
    labels: (issue.tags ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color?.background })),
    relations: relations.length > 0 ? relations : undefined,
    number: issue.numberInProject,
    reporter: mapUserRef(issue.reporter),
    updater: mapUserRef(issue.updater),
    votes: issue.votes,
    watchers: mapYouTrackWatchers(issue.watchers),
    commentsCount: issue.commentsCount,
    resolved: toIsoOrUndefined(issue.resolved),
    attachments: mapAttachments(issue.attachments),
    customFields: mapReadOnlyCustomFields(issue.customFields),
    visibility: mapTaskVisibility(issue.visibility),
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
  dueDate: toDateOnlyOrUndefined(getCustomFieldTimestamp(issue.customFields, YOUTRACK_DUE_DATE_FIELD_NAME)),
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
  reactions: c.reactions?.map(mapCommentReaction),
})

export { buildCreateIssueCustomField, buildCustomFields } from './task-helpers.js'
export { mapActivity, mapAgile, mapSavedQuery, mapSprint } from './phase-five-mappers.js'
