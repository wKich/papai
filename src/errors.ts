import { z } from 'zod'

import { type ProviderError, getProviderMessage, providerError } from './providers/errors.js'

// Re-export ProviderError and its constructors for backward compatibility
export type { ProviderError }
export { providerError }

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

export type AppError = ProviderError | LlmError | ValidationError | SystemError

export const systemError = {
  configMissing: (variable: string): AppError => ({ type: 'system', code: 'config-missing', variable }),
  networkError: (message: string): AppError => ({ type: 'system', code: 'network-error', message }),
  unexpected: (originalError: Error): AppError => ({ type: 'system', code: 'unexpected', originalError }),
}

const appErrorTypeSchema = z.object({ type: z.enum(['provider', 'llm', 'validation', 'system']) })

// Type guard to check if error is an AppError
export const isAppError = (error: unknown): error is AppError => appErrorTypeSchema.safeParse(error).success

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
    case 'provider':
      return getProviderMessage(error)
    case 'llm':
      return getLlmMessage(error)
    case 'validation':
      return getValidationMessage(error)
    case 'system':
      return getSystemMessage(error)
  }
}
