import { type AppError } from '../errors.js'
import { logger } from '../logger.js'
import { LinearApiError } from './classify-error.js'

export const requireEntity = <T>(
  entity: T | null | undefined,
  {
    entityName,
    context,
    appError,
  }: {
    entityName: string
    context: Record<string, string>
    appError: AppError
  },
): T => {
  if (entity) {
    return entity
  }
  logger.error({ entityName, ...context }, 'Linear API response missing required entity')
  throw new LinearApiError(`Linear API response missing required ${entityName}`, appError)
}

export const filterPresentNodes = <T>(
  nodes: readonly (T | null | undefined)[],
  { entityName, parentId }: { entityName: string; parentId: string },
): T[] => {
  const validNodes: T[] = []
  for (const [nodeIndex, node] of nodes.entries()) {
    if (!node) {
      logger.warn({ entityName, parentId, nodeIndex }, 'Skipping malformed Linear API node')
      continue
    }
    validNodes.push(node)
  }
  return validNodes
}
