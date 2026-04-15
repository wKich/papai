import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:list-agiles' })

export function makeListAgilesTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description: 'List agile boards available from the current task provider.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const agiles = await provider.listAgiles!()
        log.info({ count: agiles.length }, 'Agiles listed via tool')
        return agiles
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'list_agiles' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
