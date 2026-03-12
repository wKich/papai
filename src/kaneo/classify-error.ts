import { type AppError, kaneoError, systemError } from '../errors.js'
import { KaneoApiError, KaneoValidationError } from './errors.js'

export class KaneoClassifiedError extends Error {
  constructor(
    message: string,
    public readonly appError: AppError,
  ) {
    super(message)
    this.name = 'KaneoClassifiedError'
  }
}

const classifyApiError = (error: KaneoApiError): KaneoClassifiedError => {
  const { statusCode, message } = error
  const messageLower = message.toLowerCase()

  if (statusCode === 401 || statusCode === 403) {
    return new KaneoClassifiedError(message, kaneoError.authFailed())
  }
  if (statusCode === 429) {
    return new KaneoClassifiedError(message, kaneoError.rateLimited())
  }
  if (statusCode === 404) {
    if (messageLower.includes('task') || messageLower.includes('/task/')) {
      return new KaneoClassifiedError(message, kaneoError.taskNotFound('unknown'))
    }
    if (messageLower.includes('project') || messageLower.includes('/project/')) {
      return new KaneoClassifiedError(message, kaneoError.projectNotFound('unknown'))
    }
    if (messageLower.includes('label') || messageLower.includes('/label/')) {
      return new KaneoClassifiedError(message, kaneoError.labelNotFound('unknown'))
    }
    if (messageLower.includes('comment') || messageLower.includes('/activity/')) {
      return new KaneoClassifiedError(message, kaneoError.commentNotFound('unknown'))
    }
    // Unknown resource type — avoid misreporting as task-not-found
    return new KaneoClassifiedError(message, kaneoError.unknown(error))
  }
  if (statusCode === 400) {
    return new KaneoClassifiedError(message, kaneoError.validationFailed('unknown', message))
  }
  return new KaneoClassifiedError(message, systemError.unexpected(error))
}

export const classifyKaneoError = (error: unknown): KaneoClassifiedError => {
  if (error instanceof KaneoClassifiedError) {
    return error
  }
  if (error instanceof KaneoApiError) {
    return classifyApiError(error)
  }
  if (error instanceof KaneoValidationError) {
    return new KaneoClassifiedError(error.message, kaneoError.validationFailed('response', error.message))
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    if (message.includes('authentication') || message.includes('unauthorized')) {
      return new KaneoClassifiedError(error.message, kaneoError.authFailed())
    }
    if (message.includes('rate limit') || message.includes('429')) {
      return new KaneoClassifiedError(error.message, kaneoError.rateLimited())
    }
  }

  return new KaneoClassifiedError(
    error instanceof Error ? error.message : String(error),
    systemError.unexpected(error instanceof Error ? error : new Error(String(error))),
  )
}
