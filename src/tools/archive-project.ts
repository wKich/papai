import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { deleteProject } from '../kaneo/index.js'
import { logger } from '../logger.js'
import { checkConfidence, confidenceField } from './confirmation-gate.js'

const log = logger.child({ scope: 'tool:archive-project' })

export function makeArchiveProjectTool(kaneoConfig: KaneoConfig): ToolSet[string] {
  return tool({
    description: 'Archive (delete) a Kaneo project.',
    inputSchema: z.object({
      projectId: z.string().describe('Kaneo project ID'),
      label: z
        .string()
        .optional()
        .describe('Human-readable project name for the confirmation message (e.g. "Backend")'),
      confidence: confidenceField,
    }),
    execute: async ({ projectId, label, confidence }) => {
      log.debug({ projectId, confidence }, 'archive_project called')
      const gate = checkConfidence(confidence, `Archive project "${label ?? projectId}"`)
      if (gate !== null) {
        log.warn({ projectId, confidence }, 'archive_project blocked — confirmation required')
        return gate
      }
      try {
        return await deleteProject({ config: kaneoConfig, projectId })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), projectId, tool: 'archive_project' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
