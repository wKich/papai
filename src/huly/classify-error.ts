import { type AppError, linearError, systemError } from '../errors.js'
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

export function classifyHulyError(error: unknown): HulyApiError {
  log.debug({ error: error instanceof Error ? error.message : String(error) }, 'Classifying Huly error')

  if (error instanceof HulyApiError) {
    return error
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    // Authentication errors
    if (
      message.includes('authentication') ||
      message.includes('unauthorized') ||
      message.includes('invalid credentials') ||
      message.includes('login failed')
    ) {
      log.warn({ error: message }, 'Authentication error detected')
      return new HulyApiError(error.message, linearError.authFailed())
    }

    // Not found errors - detect entity type from message
    if (message.includes('not found') || message.includes('does not exist') || message.includes('document not found')) {
      log.warn({ error: message }, 'Not found error detected')
      if (message.includes('project')) {
        return new HulyApiError(error.message, linearError.projectNotFound('unknown'))
      }
      if (message.includes('label')) {
        return new HulyApiError(error.message, linearError.labelNotFound('unknown'))
      }
      if (message.includes('comment')) {
        return new HulyApiError(error.message, linearError.commentNotFound('unknown'))
      }
      if (message.includes('issue') || message.includes('task')) {
        return new HulyApiError(error.message, linearError.issueNotFound('unknown'))
      }
      return new HulyApiError(error.message, linearError.issueNotFound('unknown'))
    }

    // Validation errors
    if (
      message.includes('invalid') ||
      message.includes('validation') ||
      message.includes('required') ||
      message.includes('cannot be empty')
    ) {
      log.warn({ error: message }, 'Validation error detected')
      return new HulyApiError(error.message, linearError.validationFailed('unknown', error.message))
    }

    // Rate limit errors
    if (message.includes('rate limit') || message.includes('429') || message.includes('too many requests')) {
      log.warn({ error: message }, 'Rate limit error detected')
      return new HulyApiError(error.message, linearError.rateLimited())
    }
  }

  // Default: wrap as system error
  const errorMessage = error instanceof Error ? error.message : String(error)
  log.debug({ error: errorMessage }, 'Unknown error type, wrapping as system error')
  return new HulyApiError(
    errorMessage,
    systemError.unexpected(error instanceof Error ? error : new Error(errorMessage)),
  )
}
