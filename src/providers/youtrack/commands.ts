import type { RelationType } from '../types.js'

/** Map our RelationType to a YouTrack command string for adding a link. */
export function buildLinkCommand(type: RelationType, targetIssueId: string): string {
  switch (type) {
    case 'blocks':
      return `is required for ${targetIssueId}`
    case 'blocked_by':
      return `depends on ${targetIssueId}`
    case 'duplicate':
      return `duplicates ${targetIssueId}`
    case 'duplicate_of':
      return `is duplicated by ${targetIssueId}`
    case 'parent':
      return `subtask of ${targetIssueId}`
    case 'related':
      return `relates to ${targetIssueId}`
  }
}

/** Build a YouTrack command to remove a link. */
export function buildRemoveLinkCommand(linkTypeName: string, direction: string, targetIssueId: string): string {
  const name = linkTypeName.toLowerCase()
  if (name === 'depend' || name === 'depends') {
    return direction === 'OUTWARD' ? `remove is required for ${targetIssueId}` : `remove depends on ${targetIssueId}`
  }
  if (name === 'duplicate') {
    return direction === 'OUTWARD' ? `remove is duplicated by ${targetIssueId}` : `remove duplicates ${targetIssueId}`
  }
  if (name === 'subtask') {
    return direction === 'OUTWARD' ? `remove parent for ${targetIssueId}` : `remove subtask of ${targetIssueId}`
  }
  return `remove relates to ${targetIssueId}`
}
