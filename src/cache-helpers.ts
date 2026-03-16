import { type ModelMessage } from 'ai'

export function isValidModelMessage(item: unknown): item is ModelMessage {
  if (typeof item !== 'object' || item === null) return false
  const msg = item as { role?: unknown; content?: unknown }
  return typeof msg.role === 'string' && typeof msg.content === 'string'
}

export function parseHistoryFromDb(messagesJson: string): ModelMessage[] | null {
  try {
    const parsed: unknown = JSON.parse(messagesJson)
    if (!Array.isArray(parsed)) return null
    if (parsed.length === 0) return []
    if (parsed.every(isValidModelMessage)) return parsed
    return null
  } catch {
    return null
  }
}
