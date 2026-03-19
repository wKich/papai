/**
 * Test helper for building descriptions with relations.
 * This duplicates the internal function from src/providers/kaneo/frontmatter.ts
 * for testing purposes.
 */

import type { TaskRelation } from '../../src/providers/kaneo/frontmatter.js'

const FRONTMATTER_SEPARATOR = '---'

/**
 * Build a description string with YAML frontmatter for relations.
 */
export function buildDescriptionWithRelations(body: string, relations: TaskRelation[]): string {
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
