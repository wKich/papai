/** YouTrack API response types used internally by the provider. */

export type YtCustomField = {
  $type: string
  projectCustomField?: { field?: { name?: string } }
  value?: { name?: string; login?: string; isResolved?: boolean } | null
}

export type YtIssueLink = {
  direction: string
  linkType?: { name?: string; sourceToTarget?: string; targetToSource?: string }
  issues?: Array<{ id: string; idReadable?: string; summary?: string }>
}

export type YtTag = { id: string; name: string; color?: { background?: string } }

export type YtIssue = {
  id: string
  idReadable?: string
  summary: string
  description?: string
  created?: number
  updated?: number
  resolved?: number | null
  project?: { id: string; shortName?: string; name?: string }
  customFields?: YtCustomField[]
  tags?: YtTag[]
  links?: YtIssueLink[]
}

export type YtComment = {
  id: string
  text: string
  author?: { login?: string; name?: string }
  created?: number
}

export type YtProject = {
  id: string
  name: string
  shortName?: string
  description?: string
  archived?: boolean
}
