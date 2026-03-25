import { z } from 'zod'

// --- Condition fields and operators ---

export const CONDITION_FIELDS = [
  'task.status',
  'task.priority',
  'task.assignee',
  'task.dueDate',
  'task.project',
  'task.labels',
] as const

export type ConditionField = (typeof CONDITION_FIELDS)[number]

export const FIELD_OPERATORS: Record<ConditionField, readonly string[]> = {
  'task.status': ['eq', 'neq', 'changed_to'],
  'task.priority': ['eq', 'neq', 'changed_to'],
  'task.assignee': ['eq', 'neq', 'changed_to'],
  'task.dueDate': ['eq', 'lt', 'gt', 'overdue'],
  'task.project': ['eq', 'neq'],
  'task.labels': ['contains', 'not_contains'],
}

// --- Alert condition schema (recursive) ---

const conditionFieldSchema = z.enum(CONDITION_FIELDS)

const leafConditionSchema = z
  .object({
    field: conditionFieldSchema,
    op: z.string(),
    value: z.union([z.string(), z.number()]).optional(),
  })
  .superRefine((data, ctx) => {
    const validOps = FIELD_OPERATORS[data.field]
    if (!validOps.includes(data.op)) {
      ctx.addIssue({
        code: 'custom',
        message: `Invalid operator '${data.op}' for field '${data.field}'. Valid operators: ${validOps.join(', ')}`,
        path: ['op'],
      })
    }
    const valuelessOps = new Set(['overdue'])
    if (!valuelessOps.has(data.op) && data.value === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `Operator '${data.op}' requires a value.`,
        path: ['value'],
      })
    }
  })

export type LeafCondition = z.infer<typeof leafConditionSchema>

type AndCondition = { and: AlertCondition[] }
type OrCondition = { or: AlertCondition[] }

export type AlertCondition = LeafCondition | AndCondition | OrCondition

export const alertConditionSchema: z.ZodType<AlertCondition> = z.union([
  leafConditionSchema,
  z.object({
    and: z.lazy(() => z.array(alertConditionSchema).min(1)),
  }),
  z.object({
    or: z.lazy(() => z.array(alertConditionSchema).min(1)),
  }),
])

// --- Execution metadata ---

export const EXECUTION_MODES = ['lightweight', 'context', 'full'] as const
export type ExecutionMode = (typeof EXECUTION_MODES)[number]

export const executionMetadataSchema = z.object({
  mode: z.enum(EXECUTION_MODES),
  delivery_brief: z.string(),
  context_snapshot: z.string().nullable().default(null),
})

export type ExecutionMetadata = z.infer<typeof executionMetadataSchema>

export const DEFAULT_EXECUTION_METADATA: ExecutionMetadata = {
  mode: 'full',
  delivery_brief: '',
  context_snapshot: null,
}

// --- Domain types ---

export type ScheduledPrompt = {
  type: 'scheduled'
  id: string
  userId: string
  prompt: string
  fireAt: string
  cronExpression: string | null
  status: 'active' | 'completed' | 'cancelled'
  createdAt: string
  lastExecutedAt: string | null
  executionMetadata: ExecutionMetadata
}

export type AlertPrompt = {
  type: 'alert'
  id: string
  userId: string
  prompt: string
  condition: AlertCondition
  status: 'active' | 'cancelled'
  createdAt: string
  lastTriggeredAt: string | null
  cooldownMinutes: number
  executionMetadata: ExecutionMetadata
}

// --- Tool result types ---

type ToolError = { error: string }

export type CreateResult =
  | { status: 'created'; type: 'scheduled'; id: string; fireAt: string; cronExpression: string | null }
  | { status: 'created'; type: 'alert'; id: string; cooldownMinutes: number }
  | ToolError

export type ListResult = { prompts: Array<ScheduledPrompt | AlertPrompt> }

export type GetResult = ScheduledPrompt | AlertPrompt | ToolError

export type UpdateResult =
  | (Omit<ScheduledPrompt, 'status'> & { status: 'updated' })
  | (Omit<AlertPrompt, 'status'> & { status: 'updated' })
  | ToolError

export type CancelResult = { status: 'cancelled'; id: string } | ToolError
