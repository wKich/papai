import { z } from 'zod'

// Error categories using discriminated unions
export type LinearError =
  | { type: 'linear'; code: 'issue-not-found'; issueId: string }
  | { type: 'linear'; code: 'team-not-found'; teamId: string }
  | { type: 'linear'; code: 'auth-failed' }
  | { type: 'linear'; code: 'rate-limited' }
  | { type: 'linear'; code: 'validation-failed'; field: string; reason: string }
  | { type: 'linear'; code: 'label-not-found'; labelName: string }
  | { type: 'linear'; code: 'unknown'; originalError: Error }

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

export type AppError = LinearError | LlmError | ValidationError | SystemError

// Error constructors
export const linearError = {
  issueNotFound: (issueId: string): AppError => ({ type: 'linear', code: 'issue-not-found', issueId }),
  teamNotFound: (teamId: string): AppError => ({ type: 'linear', code: 'team-not-found', teamId }),
  authFailed: (): AppError => ({ type: 'linear', code: 'auth-failed' }),
  rateLimited: (): AppError => ({ type: 'linear', code: 'rate-limited' }),
  validationFailed: (field: string, reason: string): AppError => ({
    type: 'linear',
    code: 'validation-failed',
    field,
    reason,
  }),
  labelNotFound: (labelName: string): AppError => ({ type: 'linear', code: 'label-not-found', labelName }),
  unknown: (originalError: Error): AppError => ({ type: 'linear', code: 'unknown', originalError }),
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

const appErrorTypeSchema = z.object({ type: z.enum(['linear', 'llm', 'validation', 'system']) })

// Type guard to check if error is an AppError
export const isAppError = (error: unknown): error is AppError => appErrorTypeSchema.safeParse(error).success

// Error message mappers
const getLinearMessage = (error: LinearError): string => {
  switch (error.code) {
    case 'issue-not-found':
      return `Issue "${error.issueId}" was not found. Please check the issue ID and try again.`
    case 'team-not-found':
      return `Team configuration error. Please check LINEAR_TEAM_ID.`
    case 'auth-failed':
      return `Failed to connect to Linear. Please check your LINEAR_API_KEY.`
    case 'rate-limited':
      return `Linear API rate limit reached. Please wait a moment and try again.`
    case 'validation-failed':
      return `Invalid ${error.field}: ${error.reason}`
    case 'label-not-found':
      return `Label "${error.labelName}" was not found. Use list_labels to see available labels.`
    case 'unknown':
      return `Linear API error occurred. Please try again later.`
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
    case 'linear':
      return getLinearMessage(error)
    case 'llm':
      return getLlmMessage(error)
    case 'validation':
      return getValidationMessage(error)
    case 'system':
      return getSystemMessage(error)
  }
}
