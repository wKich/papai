/// <reference lib="dom" />
import Fuse from 'fuse.js'

import type { LogEntry } from '../schemas.js'

type SearchableLogEntry = LogEntry & { _searchText: string }

let fuseInstance: Fuse<SearchableLogEntry> | null = null

/**
 * Flattens a log entry into a searchable string by recursively
 * extracting all values from nested objects and arrays.
 */
function flattenLogEntry(entry: LogEntry): string {
  const parts: string[] = []

  // Always include message and scope
  parts.push(entry.msg)
  if (entry.scope !== undefined) {
    parts.push(entry.scope)
  }

  // Recursively extract all values
  function extractValues(value: unknown): void {
    if (value === null || value === undefined) {
      return
    }

    if (typeof value === 'string') {
      parts.push(value)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(String(value))
    } else if (Array.isArray(value)) {
      for (const item of value) {
        extractValues(item)
      }
    } else if (typeof value === 'object') {
      for (const [key, val] of Object.entries(value)) {
        // Include property keys for searching
        parts.push(key)
        extractValues(val)
      }
    }
  }

  // Extract all extra properties (excluding standard fields)
  const standardFields = new Set(['time', 'level', 'msg', 'scope'])
  for (const [key, value] of Object.entries(entry)) {
    if (!standardFields.has(key)) {
      parts.push(key)
      extractValues(value)
    }
  }

  return parts.join(' ')
}

/**
 * Creates a custom Fuse index for log entries that searches
 * across all nested properties.
 */
export function createLogSearchIndex(logs: LogEntry[]): Fuse<SearchableLogEntry> {
  // Create searchable items with flattened text
  const searchableLogs: SearchableLogEntry[] = logs.map((log) => ({
    ...log,
    _searchText: flattenLogEntry(log),
  }))

  return new Fuse(searchableLogs, {
    keys: [
      // Message has higher priority
      { name: 'msg', weight: 2 },
      { name: 'scope', weight: 1.5 },
      { name: '_searchText', weight: 1 },
    ],
    // Balance between fuzzy matching and precision
    threshold: 0.4,
    includeScore: true,
    includeMatches: false,
    // Search everywhere in the text
    ignoreLocation: true,
    minMatchCharLength: 2,
    findAllMatches: true,
  })
}

/**
 * Searches logs using Fuse.js fuzzy search.
 * Returns array of log entries sorted by relevance.
 * @public - exported for tests
 */
export function searchLogs(fuse: Fuse<SearchableLogEntry> | null, query: string): LogEntry[] {
  if (fuse === null || query.trim() === '') {
    return []
  }

  const results = fuse.search(query)
  return results.map((result) => result.item)
}

/**
 * Updates the global Fuse instance with new logs.
 * @public - exported for tests
 */
export function updateSearchIndex(logs: LogEntry[]): Fuse<SearchableLogEntry> {
  fuseInstance = createLogSearchIndex(logs)
  return fuseInstance
}

/**
 * Gets the current Fuse instance.
 * @public - exported for tests
 */
export function getSearchIndex(): Fuse<SearchableLogEntry> | null {
  return fuseInstance
}
