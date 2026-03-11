import { z } from 'zod'

// Error categories using discriminated unions
export type KaneoError =
  | { type: 'kaneo'; code: 'task-not-found'; taskId: string }
  | { type: 'kaneo'; code: 'workspace-not-found'; workspaceId: string }
  | { type: 'kaneo'; code: 'auth-failed' }
  | { type: 'kaneo'; code: 'rate-limited' }
  | { type: 'kaneo'; code: 'validation-failed'; field: string; reason: string }
  | { type: 'kaneo'; code: 'label-not-found'; labelName: string }
  | { type: 'kaneo'; code: 'project-not-found'; projectId: string }
  | { type: 'kaneo'; code: 'comment-not-found'; commentId: string }
  | { type: 'kaneo'; code: 'relation-not-found'; taskId: string; relatedTaskId: string }
  | { type: 'kaneo'; code: 'unknown'; originalError: Error }

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

export type AppError = KaneoError | LlmError | ValidationError | SystemError

// Error constructors
export const kaneoError = {
  taskNotFound: (taskId: string): AppError => ({ type: 'kaneo', code: 'task-not-found', taskId }),
  workspaceNotFound: (workspaceId: string): AppError => ({
    type: 'kaneo',
    code: 'workspace-not-found',
    workspaceId,
  }),
  authFailed: (): AppError => ({ type: 'kaneo', code: 'auth-failed' }),
  rateLimited: (): AppError => ({ type: 'kaneo', code: 'rate-limited' }),
  validationFailed: (field: string, reason: string): AppError => ({
    type: 'kaneo',
    code: 'validation-failed',
    field,
    reason,
  }),
  labelNotFound: (labelName: string): AppError => ({ type: 'kaneo', code: 'label-not-found', labelName }),
  projectNotFound: (projectId: string): AppError => ({ type: 'kaneo', code: 'project-not-found', projectId }),
  commentNotFound: (commentId: string): AppError => ({ type: 'kaneo', code: 'comment-not-found', commentId }),
  relationNotFound: (taskId: string, relatedTaskId: string): AppError => ({
    type: 'kaneo',
    code: 'relation-not-found',
    taskId,
    relatedTaskId,
  }),
  unknown: (originalError: Error): AppError => ({ type: 'kaneo', code: 'unknown', originalError }),
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

const appErrorTypeSchema = z.object({ type: z.enum(['kaneo', 'llm', 'validation', 'system']) })

// Type guard to check if error is an AppError
export const isAppError = (error: unknown): error is AppError => appErrorTypeSchema.safeParse(error).success

// Error message mappers
const getKaneoMessage = (error: KaneoError): string => {
  switch (error.code) {
    case 'task-not-found':
      return `Task "${error.taskId}" was not found. Please check the task ID and try again.`
    case 'workspace-not-found':
      return `Workspace configuration error. Please check KANEO_WORKSPACE_ID.`
    case 'auth-failed':
      return `Failed to connect to Kaneo. Please check your KANEO_KEY.`
    case 'rate-limited':
      return `Kaneo API rate limit reached. Please wait a moment and try again.`
    case 'validation-failed':
      return `Invalid ${error.field}: ${error.reason}`
    case 'label-not-found':
      return `Label "${error.labelName}" was not found. Use list_labels to see available labels.`
    case 'project-not-found':
      return `Project "${error.projectId}" was not found.`
    case 'comment-not-found':
      return `Comment "${error.commentId}" was not found.`
    case 'relation-not-found':
      return `Relation between tasks "${error.taskId}" and "${error.relatedTaskId}" was not found.`
    case 'unknown':
      return `Kaneo API error occurred. Please try again later.`
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
    case 'kaneo':
      return getKaneoMessage(error)
    case 'llm':
      return getLlmMessage(error)
    case 'validation':
      return getValidationMessage(error)
    case 'system':
      return getSystemMessage(error)
  }
}
