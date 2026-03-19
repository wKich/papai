import type { AppError } from '../../errors.js'
import { providerError, systemError } from '../../errors.js'
import { YouTrackApiError } from './client.js'

/** Classify a YouTrack error into a standardised AppError. */
export const classifyYouTrackError = (error: unknown): AppError => {
  if (error instanceof YouTrackApiError) {
    const { statusCode, message } = error
    if (statusCode === 401 || statusCode === 403) return providerError.authFailed()
    if (statusCode === 429) return providerError.rateLimited()
    if (statusCode === 404) {
      const msg = message.toLowerCase()
      if (msg.includes('issue')) return providerError.taskNotFound('unknown')
      if (msg.includes('project')) return providerError.projectNotFound('unknown')
      if (msg.includes('comment')) return providerError.commentNotFound('unknown')
      if (msg.includes('tag')) return providerError.labelNotFound('unknown')
      return providerError.unknown(error)
    }
    if (statusCode === 400) return providerError.validationFailed('unknown', message)
    return systemError.unexpected(error)
  }
  if (error instanceof Error) {
    return systemError.unexpected(error)
  }
  return systemError.unexpected(new Error(String(error)))
}
