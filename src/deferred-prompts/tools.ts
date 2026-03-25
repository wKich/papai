import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import {
  executeCancel,
  executeCreate,
  executeGet,
  executeList,
  executeUpdate,
  type CreateInput,
  type ListInput,
  type UpdateInput,
} from './tool-handlers.js'
import { alertConditionSchema, cooldownSchema, executionInputSchema, scheduleSchema } from './types.js'

const log = logger.child({ scope: 'deferred:tools' })

function logAndRethrow(name: string, error: unknown): never {
  log.error({ error: error instanceof Error ? error.message : String(error), tool: name }, 'Tool execution failed')
  throw error
}

function makeCreateTool(userId: string): ToolSet[string] {
  return tool({
    description:
      'Create a scheduled task or monitoring alert. Provide either a schedule (for time-based) or a condition (for event-based), not both. Always classify the execution mode based on what the prompt needs at fire time.',
    inputSchema: z.object({
      prompt: z.string().describe('What to do/say when this fires — not scheduling meta-instructions'),
      schedule: scheduleSchema.optional().describe('Time-based trigger (one-time or recurring)'),
      condition: alertConditionSchema.optional().describe('Event-based trigger condition'),
      cooldown_minutes: cooldownSchema,
      execution: executionInputSchema,
    }),
    execute: (input: CreateInput) => {
      try {
        return executeCreate(userId, input)
      } catch (e) {
        logAndRethrow('create_deferred_prompt', e)
      }
    },
  })
}

function makeListTool(userId: string): ToolSet[string] {
  return tool({
    description: 'List deferred prompts (scheduled tasks and monitoring alerts). Optionally filter by type or status.',
    inputSchema: z.object({
      type: z.enum(['scheduled', 'alert']).optional().describe('Filter by prompt type'),
      status: z.enum(['active', 'completed', 'cancelled']).optional().describe('Filter by status'),
    }),
    execute: (input: ListInput) => {
      try {
        return executeList(userId, input)
      } catch (e) {
        logAndRethrow('list_deferred_prompts', e)
      }
    },
  })
}

function makeGetTool(userId: string): ToolSet[string] {
  return tool({
    description: 'Get full details of a deferred prompt by ID.',
    inputSchema: z.object({ id: z.string().describe('The deferred prompt ID') }),
    execute: (input: { id: string }) => {
      try {
        return executeGet(userId, input)
      } catch (e) {
        logAndRethrow('get_deferred_prompt', e)
      }
    },
  })
}

function makeUpdateTool(userId: string): ToolSet[string] {
  return tool({
    description:
      'Update a deferred prompt. For scheduled prompts, update prompt text or schedule. For alerts, update prompt text, condition, or cooldown.',
    inputSchema: z.object({
      id: z.string().describe('The deferred prompt ID'),
      prompt: z.string().optional().describe('Updated prompt text'),
      schedule: scheduleSchema.optional().describe('Updated time-based trigger'),
      condition: alertConditionSchema.optional().describe('Updated event-based trigger condition'),
      cooldown_minutes: cooldownSchema,
      execution: executionInputSchema,
    }),
    execute: (input: UpdateInput) => {
      try {
        return executeUpdate(userId, input)
      } catch (e) {
        logAndRethrow('update_deferred_prompt', e)
      }
    },
  })
}

function makeCancelTool(userId: string): ToolSet[string] {
  return tool({
    description: 'Cancel a deferred prompt by ID. Works for both scheduled prompts and alerts.',
    inputSchema: z.object({ id: z.string().describe('The deferred prompt ID to cancel') }),
    execute: (input: { id: string }) => {
      try {
        return executeCancel(userId, input)
      } catch (e) {
        logAndRethrow('cancel_deferred_prompt', e)
      }
    },
  })
}

export function makeDeferredPromptTools(userId: string): ToolSet {
  return {
    create_deferred_prompt: makeCreateTool(userId),
    list_deferred_prompts: makeListTool(userId),
    get_deferred_prompt: makeGetTool(userId),
    update_deferred_prompt: makeUpdateTool(userId),
    cancel_deferred_prompt: makeCancelTool(userId),
  }
}
