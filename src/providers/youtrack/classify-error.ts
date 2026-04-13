import type { AppError } from '../../errors.js'
import { providerError, systemError } from '../../errors.js'
import { YouTrackApiError } from './client.js'

export class YouTrackClassifiedError extends Error {
  constructor(
    message: string,
    public readonly appError: AppError,
  ) {
    super(message)
    this.name = 'YouTrackClassifiedError'
  }
}

interface ClassificationContext {
  taskId?: string
  projectId?: string
  commentId?: string
  labelId?: string
}

interface YouTrackErrorBody {
  error?: string
  error_description?: string
  error_type?: string
  error_rule_name?: string
}

function isYouTrackErrorBody(body: unknown): body is YouTrackErrorBody {
  if (body === null || typeof body !== 'object') return false
  // Check if all expected properties are either undefined or strings
  // Use Object.entries to safely iterate over object properties
  const entries = Object.entries(body)
  for (const [key, value] of entries) {
    if (['error', 'error_description', 'error_type'].includes(key)) {
      if (value !== undefined && typeof value !== 'string') return false
    }
  }
  return true
}

const extractYouTrackErrorMessage = (error: YouTrackApiError): string => {
  const body = isYouTrackErrorBody(error.body) ? error.body : undefined
  if (body === undefined) {
    return error.message
  }
  // Prefer the descriptive error_description (often in local language)
  // Fall back to error message or the raw message
  return body.error_description ?? body.error ?? error.message
}

const classifyApiError = (error: YouTrackApiError, context?: ClassificationContext): YouTrackClassifiedError => {
  const { statusCode } = error
  const message = extractYouTrackErrorMessage(error)

  if (statusCode === 401 || statusCode === 403) {
    return new YouTrackClassifiedError(message, providerError.authFailed())
  }

  if (statusCode === 429) {
    return new YouTrackClassifiedError(message, providerError.rateLimited())
  }

  if (statusCode === 404) {
    return classifyNotFoundError(message, context)
  }

  if (statusCode === 400) {
    const body = isYouTrackErrorBody(error.body) ? error.body : undefined
    const errorType = body?.error_type
    if (errorType === 'workflow') {
      return new YouTrackClassifiedError(message, providerError.validationFailed('workflow', message))
    }
    return new YouTrackClassifiedError(message, providerError.validationFailed('unknown', message))
  }

  return new YouTrackClassifiedError(message, systemError.unexpected(error))
}

const classifyNotFoundError = (message: string, context?: ClassificationContext): YouTrackClassifiedError => {
  const msg = message.toLowerCase()

  if (msg.includes('issue') || msg.includes('/issues/')) {
    return new YouTrackClassifiedError(message, providerError.taskNotFound(context?.taskId ?? 'unknown'))
  }

  if (msg.includes('project') || msg.includes('/projects/')) {
    return new YouTrackClassifiedError(message, providerError.projectNotFound(context?.projectId ?? 'unknown'))
  }

  if (msg.includes('comment') || msg.includes('/comments/')) {
    return new YouTrackClassifiedError(message, providerError.commentNotFound(context?.commentId ?? 'unknown'))
  }

  if (msg.includes('tag') || msg.includes('/tags/')) {
    return new YouTrackClassifiedError(message, providerError.labelNotFound(context?.labelId ?? 'unknown'))
  }

  return new YouTrackClassifiedError(message, providerError.unknown(new Error(message)))
}

const classifyGenericError = (error: Error): YouTrackClassifiedError => {
  const msg = error.message.toLowerCase()

  if (msg.includes('authentication') || msg.includes('unauthorized')) {
    return new YouTrackClassifiedError(error.message, providerError.authFailed())
  }

  if (msg.includes('rate limit') || msg.includes('429')) {
    return new YouTrackClassifiedError(error.message, providerError.rateLimited())
  }

  // Network error detection before final fallback
  if (
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('connect')
  ) {
    return new YouTrackClassifiedError(error.message, systemError.networkError(error.message))
  }

  return new YouTrackClassifiedError(error.message, systemError.unexpected(error))
}

/** Classify a YouTrack error into a YouTrackClassifiedError carrying a standardised AppError. */
export const classifyYouTrackError = (error: unknown, context?: ClassificationContext): YouTrackClassifiedError => {
  if (error instanceof YouTrackClassifiedError) {
    return error
  }

  if (error instanceof YouTrackApiError) {
    return classifyApiError(error, context)
  }

  if (error instanceof Error) {
    return classifyGenericError(error)
  }

  return new YouTrackClassifiedError(String(error), systemError.unexpected(new Error(String(error))))
}
