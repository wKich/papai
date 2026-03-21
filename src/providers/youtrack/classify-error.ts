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

/** Classify a YouTrack error into a YouTrackClassifiedError carrying a standardised AppError. */
export const classifyYouTrackError = (error: unknown, context?: ClassificationContext): YouTrackClassifiedError => {
  if (error instanceof YouTrackClassifiedError) {
    return error
  }
  if (error instanceof YouTrackApiError) {
    const { statusCode, message } = error
    if (statusCode === 401 || statusCode === 403) {
      return new YouTrackClassifiedError(message, providerError.authFailed())
    }
    if (statusCode === 429) {
      return new YouTrackClassifiedError(message, providerError.rateLimited())
    }
    if (statusCode === 404) {
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
      return new YouTrackClassifiedError(message, providerError.unknown(error))
    }
    if (statusCode === 400) {
      return new YouTrackClassifiedError(message, providerError.validationFailed('unknown', message))
    }
    return new YouTrackClassifiedError(message, systemError.unexpected(error))
  }
  if (error instanceof Error) {
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
  return new YouTrackClassifiedError(String(error), systemError.unexpected(new Error(String(error))))
}
