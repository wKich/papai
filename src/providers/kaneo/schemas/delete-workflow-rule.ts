import { z } from 'zod'

export const DeleteWorkflowRulePathParamsSchema = z.object({
  id: z.string(),
})

export const DeleteWorkflowRuleResponseSchema = z.object({})

export type DeleteWorkflowRulePathParams = z.infer<typeof DeleteWorkflowRulePathParamsSchema>
export type DeleteWorkflowRuleResponse = z.infer<typeof DeleteWorkflowRuleResponseSchema>
