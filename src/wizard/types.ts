/**
 * Wizard state types for interactive configuration setup
 */

import type { ConfigKey } from '../types/config.js'

/**
 * User session tracking for the configuration wizard
 */
export interface WizardSession {
  userId: string
  storageContextId: string
  startedAt: Date
  currentStep: number
  totalSteps: number
  data: WizardData
  skippedSteps: number[]
  platform: 'telegram' | 'mattermost'
  taskProvider: 'kaneo' | 'youtrack'
}

/**
 * Data collected during wizard execution, keyed by ConfigKey
 */
export type WizardData = Partial<Record<ConfigKey, string>>

/**
 * Individual step definition in the wizard
 */
export interface WizardStep {
  id: string
  key: ConfigKey
  prompt: string
  validate: (value: string) => Promise<string | null>
  liveCheck?: (value: string) => boolean
  isOptional?: boolean
}

/**
 * Result returned from processing a wizard interaction
 */
export interface WizardProcessResult {
  handled: boolean
  response?: string
  requiresInput?: boolean
}
