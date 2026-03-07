import { type AppError } from '../errors.js'
import { logger } from '../logger.js'
import { HulyApiError } from './classify-error.js'

const log = logger.child({ scope: 'huly:response-guards' })

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
  if (entity !== null && entity !== undefined) {
    return entity
  }
  throw new HulyApiError(`API response missing required ${entityName}: ${JSON.stringify(context)}`, appError)
}

export const filterPresentNodes = <T>(
  nodes: readonly (T | null | undefined)[],
  { entityName, parentId }: { entityName: string; parentId: string },
): T[] => {
  const validNodes: T[] = []
  for (const [nodeIndex, node] of nodes.entries()) {
    if (node === null || node === undefined) {
      log.warn({ entityName, parentId, nodeIndex }, 'Skipping malformed Huly API node')
      continue
    }
    validNodes.push(node)
  }
  return validNodes
}
