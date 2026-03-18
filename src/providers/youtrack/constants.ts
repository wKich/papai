import type { Capability, ProviderConfigRequirement } from '../types.js'

/** Fields parameter for issue requests returning full detail. */
export const ISSUE_FIELDS = [
  'id',
  'idReadable',
  'summary',
  'description',
  'created',
  'updated',
  'resolved',
  'project(id,shortName,name)',
  'customFields($type,name,value($type,name,login))',
  'tags(id,name,color(id,background))',
  'links(id,direction,linkType(name,sourceToTarget,targetToSource),issues(id,idReadable,summary))',
].join(',')

/** Lighter fields for list/search results. */
export const ISSUE_LIST_FIELDS = [
  'id',
  'idReadable',
  'summary',
  'project(id,shortName)',
  'customFields($type,projectCustomField(field(name)),value($type,name))',
].join(',')

export const COMMENT_FIELDS = 'id,text,author(login,name),created,updated'
export const PROJECT_FIELDS = 'id,name,shortName,description,archived'
export const TAG_FIELDS = 'id,name,color(id,background)'

export const YOUTRACK_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  // Tasks
  'tasks.delete',
  'tasks.relations',
  // Projects (full CRUD)
  'projects.read',
  'projects.list',
  'projects.create',
  'projects.update',
  'projects.archive',
  // Comments (full CRUD)
  'comments.read',
  'comments.create',
  'comments.update',
  'comments.delete',
  // Labels (full CRUD + assignment)
  'labels.list',
  'labels.create',
  'labels.update',
  'labels.delete',
  'labels.assign',
  // Statuses (YouTrack uses State custom fields, not explicit status management)
])

export const CONFIG_REQUIREMENTS: readonly ProviderConfigRequirement[] = [
  { key: 'youtrack_url', label: 'YouTrack Base URL', required: true },
  { key: 'youtrack_token', label: 'YouTrack Permanent Token', required: true },
]
