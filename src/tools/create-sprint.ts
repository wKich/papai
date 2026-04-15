import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:create-sprint' })

export function makeCreateSprintTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description: 'Create a sprint on a YouTrack agile board.',
    inputSchema: z.object({
      agileId: z.string().describe('Agile board ID'),
      name: z.string().describe('Sprint name'),
      goal: z.string().optional().describe('Optional sprint goal'),
      start: z.string().optional().describe('Sprint start timestamp in ISO-8601 format'),
      finish: z.string().optional().describe('Sprint finish timestamp in ISO-8601 format'),
      previousSprintId: z.string().optional().describe('Optional previous sprint ID'),
      isDefault: z.boolean().optional().describe('Whether the sprint should become the default sprint'),
    }),
    execute: async ({ agileId, ...params }) => {
      try {
        const sprint = await provider.createSprint!(agileId, params)
        log.info({ agileId, sprintId: sprint.id }, 'Sprint created via tool')
        return sprint
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), agileId, tool: 'create_sprint' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
