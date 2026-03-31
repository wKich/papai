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
 * Stable key for snapshot filenames — replaces `/` and `.` with `_`.
 * @param {string} absPath - Absolute file path
 * @returns {string}
 */
export function getSnapshotKey(absPath) {
  return absPath.replace(/[/.]/g, '_')
}
