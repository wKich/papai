import type { z } from 'zod'

import type {
  Attachment,
  Comment,
  CommentReaction,
  RelationType,
  Task,
  TaskListItem,
  TaskSearchResult,
  TaskVisibility,
  UserRef,
  VisibilityGroupRef,
} from '../types.js'
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
    dueDate: null,
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

/** Build custom fields array for create/update requests. */
export const buildCustomFields = (params: {
  status?: string
  priority?: string
  assignee?: string
  customFields?: Array<{ name: string; value: string }>
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
  if (params.customFields !== undefined) {
    for (const field of params.customFields) {
      fields.push({ name: field.name, $type: 'SimpleIssueCustomField', value: { text: field.value } })
    }
  }
  return fields
}

export { mapActivity, mapAgile, mapSavedQuery, mapSprint } from './phase-five-mappers.js'
