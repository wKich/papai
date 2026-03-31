import { createHash } from 'node:crypto'
import path from 'node:path'

/**
 * Directory where session state files are stored.
 * @param {string} cwd - Project root
 * @returns {string}
 */
export function getSessionsDir(cwd) {
  return path.join(cwd, '.hooks', 'sessions')
}

/**
 * Generate a file key from absolute path for snapshot storage.
 * Uses SHA-256 hash truncated to 16 characters for uniqueness.
 * Format: tdd-{type}-${session_id}-${hash} (per PIPELINES.md)
 * Note: For SessionState, session_id is handled by the session isolation.
 * @param {string} absPath - Absolute file path
 * @returns {string}
 */
export function getFileKey(absPath) {
  return createHash('sha256').update(absPath).digest('hex').slice(0, 16)
}
