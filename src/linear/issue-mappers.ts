import type { IssueRelation, IssueLabel } from '@linear/sdk'

import { logger } from '../logger.js'
import { filterPresentNodes } from './response-guards.js'

const log = logger.child({ scope: 'linear:issue-mappers' })

export interface MappedLabel {
  id: string
  name: string
  color: string
}

export interface MappedRelation {
  id: string
  type: string
  relatedIssueId: string | undefined
  relatedIdentifier: string | undefined
}

export function mapLabels(labels: { nodes: (IssueLabel | null | undefined)[] }, issueId: string): MappedLabel[] {
  return filterPresentNodes(labels.nodes, { entityName: 'label', parentId: issueId }).flatMap((l) => {
    if (typeof l.id !== 'string' || typeof l.name !== 'string' || typeof l.color !== 'string') {
      log.warn({ issueId, labelId: l.id }, 'Skipping label with invalid response shape')
      return []
    }
    return [{ id: l.id, name: l.name, color: l.color }]
  })
}

export async function mapRelations(
  relations: { nodes: (IssueRelation | null | undefined)[] },
  issueId: string,
): Promise<MappedRelation[]> {
  const mappedRelations = await Promise.all(
    filterPresentNodes(relations.nodes, { entityName: 'relation', parentId: issueId }).map(async (r) => {
      if (typeof r.id !== 'string' || typeof r.type !== 'string') {
        log.warn({ issueId, relationId: r.id }, 'Skipping relation with invalid response shape')
        return undefined
      }
      const relatedIssue = await r.relatedIssue
      return { id: r.id, type: r.type, relatedIssueId: relatedIssue?.id, relatedIdentifier: relatedIssue?.identifier }
    }),
  )
  return mappedRelations.flatMap((relation) => (relation ? [relation] : []))
}
