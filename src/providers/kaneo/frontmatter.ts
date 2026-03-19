import { logger } from '../../logger.js'

const log = logger.child({ scope: 'kaneo:frontmatter' })

export interface TaskRelation {
  type: 'blocks' | 'blocked_by' | 'duplicate' | 'duplicate_of' | 'related' | 'parent'
  taskId: string
}

const FRONTMATTER_SEPARATOR = '---'

export function parseRelationsFromDescription(description: string | undefined | null): {
  relations: TaskRelation[]
  body: string
} {
  if (description === undefined || description === null || description.length === 0) {
    return { relations: [], body: '' }
  }

  const trimmed = description.trim()
  if (!trimmed.startsWith(FRONTMATTER_SEPARATOR)) {
    return { relations: [], body: description }
  }

  const endIndex = trimmed.indexOf(FRONTMATTER_SEPARATOR, FRONTMATTER_SEPARATOR.length)
  if (endIndex === -1) {
    return { relations: [], body: description }
  }

  const frontmatterContent = trimmed.slice(FRONTMATTER_SEPARATOR.length, endIndex).trim()
  const body = trimmed.slice(endIndex + FRONTMATTER_SEPARATOR.length).trim()
  const relations: TaskRelation[] = []

  for (const line of frontmatterContent.split('\n')) {
    const match = line.trim().match(/^(blocks|blocked_by|duplicate|duplicate_of|related|parent):\s*(.+)$/)
    if (match !== null) {
      const ids = match[2]!
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
      const type = match[1]!
      if (
        type === 'blocks' ||
        type === 'blocked_by' ||
        type === 'duplicate' ||
        type === 'duplicate_of' ||
        type === 'related' ||
        type === 'parent'
      ) {
        for (const taskId of ids) {
          relations.push({ type, taskId })
        }
      }
    }
  }

  log.debug({ relationCount: relations.length }, 'Parsed relations from frontmatter')
  return { relations, body }
}

function buildDescriptionWithRelations(body: string, relations: TaskRelation[]): string {
  if (relations.length === 0) {
    return body
  }

  const grouped: Record<string, string[]> = {}
  for (const rel of relations) {
    const arr = (grouped[rel.type] ??= [])
    arr.push(rel.taskId)
  }

  const lines: string[] = []
  for (const type of ['blocks', 'blocked_by', 'duplicate', 'duplicate_of', 'related', 'parent'] as const) {
    const ids = grouped[type]
    if (ids !== undefined && ids.length > 0) {
      lines.push(`${type}: ${ids.join(', ')}`)
    }
  }

  const frontmatter = `${FRONTMATTER_SEPARATOR}\n${lines.join('\n')}\n${FRONTMATTER_SEPARATOR}`
  return body.length > 0 ? `${frontmatter}\n${body}` : frontmatter
}

export function addRelation(description: string | undefined, relation: TaskRelation): string {
  const { relations, body } = parseRelationsFromDescription(description)
  const exists = relations.some((r) => r.type === relation.type && r.taskId === relation.taskId)
  if (exists) {
    log.debug({ relation }, 'Relation already exists, skipping')
    return description ?? ''
  }
  relations.push(relation)
  return buildDescriptionWithRelations(body, relations)
}

export function removeRelation(description: string | undefined, taskId: string): string {
  const { relations, body } = parseRelationsFromDescription(description)
  const filtered = relations.filter((r) => r.taskId !== taskId)
  return buildDescriptionWithRelations(body, filtered)
}

export function updateRelation(description: string | undefined, taskId: string, newType: TaskRelation['type']): string {
  const { relations, body } = parseRelationsFromDescription(description)
  const updated = relations.map((r) => (r.taskId === taskId ? { ...r, type: newType } : r))
  return buildDescriptionWithRelations(body, updated)
}
