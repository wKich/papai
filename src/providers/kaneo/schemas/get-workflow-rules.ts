import { z } from 'zod'

export const GetWorkflowRulesPathParamsSchema = z.object({
  projectId: z.string(),
})

export const GetWorkflowRulesResponseSchema = z.object({})

export type GetWorkflowRulesPathParams = z.infer<typeof GetWorkflowRulesPathParamsSchema>
export type GetWorkflowRulesResponse = z.infer<typeof GetWorkflowRulesResponseSchema>
