/// <reference lib="dom" />
import type { LogEntry } from '../schemas.js'
import { parseLogEntry } from '../schemas.js'
import { state } from './state.js'

export function processLogsForScopes(logs: LogEntry[]): void {
  for (const entry of logs) {
    if (entry.scope !== undefined) state.logScopes.add(entry.scope)
  }
}

export function parseLogsArray(logs: unknown[]): LogEntry[] {
  const parsedLogs: LogEntry[] = []
  for (const log of logs) {
    try {
      parsedLogs.push(parseLogEntry(log))
    } catch {
      // Skip invalid log entries
    }
  }
  return parsedLogs
}

export async function bootstrapLogs(): Promise<void> {
  const res = await fetch('/logs')
  if (!res.ok) return
  const logs: unknown = await res.json()
  if (!Array.isArray(logs)) return
  const parsedLogs = parseLogsArray(logs)
  state.logs = parsedLogs
  processLogsForScopes(parsedLogs)
  window.dashboard.updateScopeFilter(state.logScopes)
  window.dashboard.renderLogs()
}
