import { type AppError, hulyError, systemError } from '../errors.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'huly:classify-error' })

export class HulyApiError extends Error {
  constructor(
    message: string,
    public readonly appError: AppError,
  ) {
    super(message)
    this.name = 'HulyApiError'
  }
}

function isAuthError(message: string): boolean {
  return (
    message.includes('authentication') ||
    message.includes('unauthorized') ||
    message.includes('invalid credentials') ||
    message.includes('login failed')
  )
}

function classifyNotFoundError(message: string, originalMessage: string): HulyApiError {
  log.warn({ error: message }, 'Not found error detected')
  if (message.includes('project')) {
    return new HulyApiError(originalMessage, hulyError.projectNotFound('unknown'))
  }
  if (message.includes('label')) {
    return new HulyApiError(originalMessage, hulyError.labelNotFound('unknown'))
  }
  if (message.includes('comment')) {
    return new HulyApiError(originalMessage, hulyError.commentNotFound('unknown'))
  }
  if (message.includes('issue') || message.includes('task')) {
    return new HulyApiError(originalMessage, hulyError.issueNotFound('unknown'))
  }
  return new HulyApiError(originalMessage, hulyError.issueNotFound('unknown'))
}

function isNotFoundError(message: string): boolean {
  return message.includes('not found') || message.includes('does not exist') || message.includes('document not found')
}

function isValidationError(message: string): boolean {
  return (
    message.includes('invalid') ||
    message.includes('validation') ||
    message.includes('required') ||
    message.includes('cannot be empty')
  )
}

function isRateLimitError(message: string): boolean {
  return message.includes('rate limit') || message.includes('429') || message.includes('too many requests')
}

function classifyErrorMessage(error: Error): HulyApiError | undefined {
  const message = error.message.toLowerCase()

  if (isAuthError(message)) {
    log.warn({ error: message }, 'Authentication error detected')
    return new HulyApiError(error.message, hulyError.authFailed())
  }

  if (isNotFoundError(message)) {
    return classifyNotFoundError(message, error.message)
  }

  if (isValidationError(message)) {
    log.warn({ error: message }, 'Validation error detected')
    return new HulyApiError(error.message, hulyError.validationFailed('unknown', error.message))
  }

  if (isRateLimitError(message)) {
    log.warn({ error: message }, 'Rate limit error detected')
    return new HulyApiError(error.message, hulyError.rateLimited())
  }

  return undefined
}

function createSystemError(error: unknown): HulyApiError {
  const errorMessage = error instanceof Error ? error.message : String(error)
  log.debug({ error: errorMessage }, 'Unknown error type, wrapping as system error')
  return new HulyApiError(
    errorMessage,
    systemError.unexpected(error instanceof Error ? error : new Error(errorMessage)),
  )
}

export function classifyHulyError(error: unknown): HulyApiError {
  log.debug({ error: error instanceof Error ? error.message : String(error) }, 'Classifying Huly error')

  if (error instanceof HulyApiError) {
    return error
  }

  if (error instanceof Error) {
    const classified = classifyErrorMessage(error)
    if (classified !== undefined) {
      return classified
    }
  }

  return createSystemError(error)
}
