import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { clearIdentityMapping, getIdentityMapping } from '../identity/mapping.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:clear-my-identity' })

export function makeClearMyIdentityTool(provider: TaskProvider, chatUserId: string): ToolSet[string] {
  return tool({
    description:
      "Clear the user's task tracker identity mapping. Use when user says things like 'I'm not Alice', 'That's not me', 'These aren't my tasks', or 'Unlink my account'.",
    inputSchema: z.object({}),
    execute: () => {
      log.debug({ chatUserId }, 'clear_my_identity called')

      const existing = getIdentityMapping(chatUserId, provider.name)
      if (existing === null || existing.providerUserId === null) {
        return {
          status: 'info',
          message: 'No identity mapping to clear.',
        }
      }

      clearIdentityMapping(chatUserId, provider.name)

      log.info({ chatUserId }, 'Identity cleared via NL')
      return {
        status: 'success',
        message: "Okay, I've unlinked you. Tell me your correct login (e.g., 'I'm jsmith').",
      }
    },
  })
}
