// Error categories using discriminated unions
export type LinearError =
  | { type: 'linear'; code: 'issue-not-found'; issueId: string }
  | { type: 'linear'; code: 'team-not-found'; teamId: string }
  | { type: 'linear'; code: 'auth-failed' }
  | { type: 'linear'; code: 'rate-limited' }
  | { type: 'linear'; code: 'validation-failed'; field: string; reason: string }
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

// Type guard to check if error is an AppError
export const isAppError = (error: unknown): error is AppError => {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const typeValue = (error as { type?: unknown }).type
  return typeValue === 'linear' || typeValue === 'llm' || typeValue === 'validation' || typeValue === 'system'
}
