import type { IncomingFile } from './chat/types.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'file-relay' })

/**
 * In-memory relay keyed by storageContextId.
 * Holds the latest set of incoming files for the current turn so that
 * tools (e.g. upload_attachment) can retrieve them during LLM execution.
 */
const relay = new Map<string, IncomingFile[]>()

/** Store incoming files for a context, replacing any previously stored files. */
export function storeIncomingFiles(contextId: string, files: readonly IncomingFile[]): void {
  log.debug({ contextId, count: files.length }, 'Storing incoming files in relay')
  relay.set(contextId, [...files])
}

/** Retrieve the currently stored files for a context. Returns [] if none. */
export function getIncomingFiles(contextId: string): IncomingFile[] {
  return relay.get(contextId) ?? []
}

/** Remove stored files for a context (call when a turn produces no files). */
export function clearIncomingFiles(contextId: string): void {
  relay.delete(contextId)
  log.debug({ contextId }, 'Cleared incoming files from relay')
}
