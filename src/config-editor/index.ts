/**
 * Config Editor - standalone configuration field editing
 * Provides button-based UI for editing individual config fields
 * Separate from the wizard - no singleStep hack needed
 */

export { handleEditorCallback, handleEditorMessage, parseCallbackData, startEditor } from './handlers.js'
export {
  createEditorSession,
  deleteEditorSession,
  getEditorSession,
  hasActiveEditor,
  updateEditorSession,
} from './state.js'
export type {
  ConfigEditorSession,
  CreateEditorSessionParams,
  EditorButton,
  EditorProcessResult,
  ValidationResult,
} from './types.js'
