import { z } from 'zod'

export const UpsertWorkflowRulePathParamsSchema = z.object({
  projectId: z.string(),
})

export const UpsertWorkflowRuleRequestSchema = z.object({
  integrationType: z.string(),
  eventType: z.string(),
  columnId: z.string(),
})

export const UpsertWorkflowRuleResponseSchema = z.object({})

export type UpsertWorkflowRulePathParams = z.infer<typeof UpsertWorkflowRulePathParamsSchema>
export type UpsertWorkflowRuleRequest = z.infer<typeof UpsertWorkflowRuleRequestSchema>
export type UpsertWorkflowRuleResponse = z.infer<typeof UpsertWorkflowRuleResponseSchema>
