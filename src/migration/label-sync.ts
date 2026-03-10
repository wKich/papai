import core, { generateId } from '@hcengineering/core'
import tags, { type TagElement } from '@hcengineering/tags'
import tracker from '@hcengineering/tracker'

import type { HulyClient } from '../huly/types.js'
import { logger } from '../logger.js'
import type { LinearIssue } from './linear-client.js'

const log = logger.child({ scope: 'migration:labels' })

// Returns a name → Huly label ID map, creating missing labels as needed.
export async function buildLabelCache(client: HulyClient, linearIssues: LinearIssue[]): Promise<Map<string, string>> {
  const neededLabels = collectNeededLabels(linearIssues)
  if (neededLabels.size === 0) return new Map()

  const existing = await client.findAll<TagElement>(tags.class.TagElement, {
    targetClass: tracker.class.Issue,
  })

  const cache = new Map<string, string>(existing.map((l) => [l.title, l._id as string]))

  const missing = [...neededLabels.entries()].filter(([name]) => !cache.has(name))

  const created = await Promise.all(
    missing.map(async ([name, color]) => {
      const labelId = await createTagElement(client, name, color)
      log.info({ name, labelId }, 'Created label')
      return [name, labelId] as const
    }),
  )

  for (const [name, id] of created) {
    cache.set(name, id)
  }

  return cache
}

function collectNeededLabels(linearIssues: LinearIssue[]): Map<string, string> {
  const needed = new Map<string, string>()
  for (const issue of linearIssues) {
    for (const label of issue.labels) {
      if (!needed.has(label.name)) {
        needed.set(label.name, label.color)
      }
    }
  }
  return needed
}

async function createTagElement(client: HulyClient, name: string, color: string): Promise<string> {
  const labelId = generateId<TagElement>()
  const colorNum = parseInt(color.replace(/^#/, ''), 16) || 0
  await client.createDoc(
    tags.class.TagElement,
    core.space.Workspace,
    {
      title: name,
      color: colorNum,
      description: '',
      category: tags.category.NoCategory,
      targetClass: tracker.class.Issue,
    },
    labelId,
  )
  return labelId as string
}
