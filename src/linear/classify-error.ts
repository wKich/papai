import { type AppError, linearError, systemError } from '../errors.js'

export class LinearApiError extends Error {
  constructor(
    message: string,
    public readonly appError: AppError,
  ) {
    super(message)
    this.name = 'LinearApiError'
  }
}

export const classifyLinearError = (error: unknown): LinearApiError => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    if (message.includes('not found') || message.includes('issue') || message.includes('resource')) {
      return new LinearApiError(error.message, linearError.issueNotFound('unknown'))
    }
    if (message.includes('authentication') || message.includes('unauthorized') || message.includes('auth')) {
      return new LinearApiError(error.message, linearError.authFailed())
    }
    if (message.includes('rate limit') || message.includes('ratelimit') || message.includes('429')) {
      return new LinearApiError(error.message, linearError.rateLimited())
    }
    if (message.includes('validation') || message.includes('invalid')) {
      return new LinearApiError(error.message, linearError.validationFailed('unknown', error.message))
    }
  }
  return new LinearApiError(
    error instanceof Error ? error.message : String(error),
    systemError.unexpected(error instanceof Error ? error : new Error(String(error))),
  )
}
