import { z } from 'zod'

// Error categories using discriminated unions
export type HulyError =
  | { type: 'huly'; code: 'issue-not-found'; issueId: string }
  | { type: 'huly'; code: 'team-not-found'; teamId: string }
  | { type: 'huly'; code: 'auth-failed' }
  | { type: 'huly'; code: 'rate-limited' }
  | { type: 'huly'; code: 'validation-failed'; field: string; reason: string }
  | { type: 'huly'; code: 'label-not-found'; labelName: string }
  | { type: 'huly'; code: 'project-not-found'; projectId: string }
  | { type: 'huly'; code: 'comment-not-found'; commentId: string }
  | { type: 'huly'; code: 'relation-not-found'; issueId: string; relatedIssueId: string }
  | { type: 'huly'; code: 'unknown'; originalError: Error }

export type LlmError =
  | { type: 'llm'; code: 'api-error'; message: string }
  | { type: 'llm'; code: 'rate-limited' }
  | { type: 'llm'; code: 'timeout' }
  | { type: 'llm'; code: 'token-limit' }

export type ValidationError =
  | { type: 'validation'; code: 'invalid-input'; field: string; reason: string }
  | { type: 'validation'; code: 'missing-required'; field: string }

export type SystemError =
  | { type: 'system'; code: 'config-missing'; variable: string }
  | { type: 'system'; code: 'network-error'; message: string }
  | { type: 'system'; code: 'unexpected'; originalError: Error }

export type AppError = HulyError | LlmError | ValidationError | SystemError

// Error constructors
export const hulyError = {
  issueNotFound: (issueId: string): AppError => ({ type: 'huly', code: 'issue-not-found', issueId }),
  teamNotFound: (teamId: string): AppError => ({ type: 'huly', code: 'team-not-found', teamId }),
  authFailed: (): AppError => ({ type: 'huly', code: 'auth-failed' }),
  rateLimited: (): AppError => ({ type: 'huly', code: 'rate-limited' }),
  validationFailed: (field: string, reason: string): AppError => ({
    type: 'huly',
    code: 'validation-failed',
    field,
    reason,
  }),
  labelNotFound: (labelName: string): AppError => ({ type: 'huly', code: 'label-not-found', labelName }),
  projectNotFound: (projectId: string): AppError => ({ type: 'huly', code: 'project-not-found', projectId }),
  commentNotFound: (commentId: string): AppError => ({ type: 'huly', code: 'comment-not-found', commentId }),
  relationNotFound: (issueId: string, relatedIssueId: string): AppError => ({
    type: 'huly',
    code: 'relation-not-found',
    issueId,
    relatedIssueId,
  }),
  unknown: (originalError: Error): AppError => ({ type: 'huly', code: 'unknown', originalError }),
}

export const llmError = {
  apiError: (message: string): AppError => ({ type: 'llm', code: 'api-error', message }),
  rateLimited: (): AppError => ({ type: 'llm', code: 'rate-limited' }),
  timeout: (): AppError => ({ type: 'llm', code: 'timeout' }),
  tokenLimit: (): AppError => ({ type: 'llm', code: 'token-limit' }),
}

export const validationError = {
  invalidInput: (field: string, reason: string): AppError => ({
    type: 'validation',
    code: 'invalid-input',
    field,
    reason,
  }),
  missingRequired: (field: string): AppError => ({ type: 'validation', code: 'missing-required', field }),
}

export const systemError = {
  configMissing: (variable: string): AppError => ({ type: 'system', code: 'config-missing', variable }),
  networkError: (message: string): AppError => ({ type: 'system', code: 'network-error', message }),
  unexpected: (originalError: Error): AppError => ({ type: 'system', code: 'unexpected', originalError }),
}

const appErrorTypeSchema = z.object({ type: z.enum(['huly', 'llm', 'validation', 'system']) })

// Type guard to check if error is an AppError
export const isAppError = (error: unknown): error is AppError => appErrorTypeSchema.safeParse(error).success

// Error message mappers
const getHulyMessage = (error: HulyError): string => {
  switch (error.code) {
    case 'issue-not-found':
      return `Issue "${error.issueId}" was not found. Please check the issue ID and try again.`
    case 'team-not-found':
      return `Team configuration error. Please check Huly project configuration.`
    case 'auth-failed':
      return `Failed to connect to Huly. Please check your HULY_API_KEY.`
    case 'rate-limited':
      return `Huly API rate limit reached. Please wait a moment and try again.`
    case 'validation-failed':
      return `Invalid ${error.field}: ${error.reason}`
    case 'label-not-found':
      return `Label "${error.labelName}" was not found. Use list_labels to see available labels.`
    case 'project-not-found':
      return `Project "${error.projectId}" was not found.`
    case 'comment-not-found':
      return `Comment "${error.commentId}" was not found.`
    case 'relation-not-found':
      return `Relation between issues "${error.issueId}" and "${error.relatedIssueId}" was not found.`
    case 'unknown':
      return `Huly API error occurred. Please try again later.`
  }
}

const getLlmMessage = (error: LlmError): string => {
  switch (error.code) {
    case 'api-error':
      return `AI service error: ${error.message}. Please try again.`
    case 'rate-limited':
      return `AI service rate limit reached. Please wait a moment and try again.`
    case 'timeout':
      return `AI service request timed out. Please try again.`
    case 'token-limit':
      return `Message is too long. Please shorten your request and try again.`
  }
}

const getValidationMessage = (error: ValidationError): string => {
  switch (error.code) {
    case 'invalid-input':
      return `Invalid ${error.field}: ${error.reason}`
    case 'missing-required':
      return `Missing required field: ${error.field}`
  }
}

const getSystemMessage = (error: SystemError): string => {
  switch (error.code) {
    case 'config-missing':
      return `Configuration error: ${error.variable} is not set. Please use /set command to configure.`
    case 'network-error':
      return `Network error: ${error.message}. Please check your connection and try again.`
    case 'unexpected':
      return `An unexpected error occurred. Please try again later.`
  }
}

export const getUserMessage = (error: AppError): string => {
  switch (error.type) {
    case 'huly':
      return getHulyMessage(error)
    case 'llm':
      return getLlmMessage(error)
    case 'validation':
      return getValidationMessage(error)
    case 'system':
      return getSystemMessage(error)
  }
}
