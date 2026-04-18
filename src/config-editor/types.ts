/**
 * Config Editor types for standalone configuration field editing
 * Separate from wizard - no singleStep hack
 */

import type { ConfigKey } from '../types/config.js'

/**
 * User session tracking for editing a single config field
 */
export interface ConfigEditorSession {
  userId: string
  storageContextId: string
  startedAt: Date
  editingKey: ConfigKey
  pendingValue?: string
  originalMessageId?: string
}

/**
 * Parameters required to create a new config editor session
 */
export interface CreateEditorSessionParams {
  readonly userId: string
  readonly storageContextId: string
  readonly editingKey: ConfigKey
  readonly originalMessageId?: string
}

/**
 * Button for config editor interactions
 */
export interface EditorButton {
  text: string
  action: 'edit' | 'save' | 'cancel' | 'back' | 'setup'
  key?: ConfigKey
  style?: 'primary' | 'secondary' | 'danger'
}

/**
 * Result returned from processing a config editor callback
 */
export interface EditorProcessResult {
  handled: boolean
  response?: string
  buttons?: EditorButton[]
  editOriginal?: boolean
  isSensitiveKey?: boolean
}

/**
 * Validation result for config values
 */
export interface ValidationResult {
  valid: boolean
  error?: string
}
