import type { RelationType } from '../../types.js'
import { addTaskRelation, removeTaskRelation, updateTaskRelation } from '../api.js'
import type { KaneoConfig } from '../client.js'

export function kaneoAddRelation(
  config: KaneoConfig,
  taskId: string,
  relatedTaskId: string,
  type: RelationType,
): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
  return addTaskRelation({ config, taskId, relatedTaskId, type })
}

export function kaneoUpdateRelation(
  config: KaneoConfig,
  taskId: string,
  relatedTaskId: string,
  type: RelationType,
): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
  return updateTaskRelation({ config, taskId, relatedTaskId, type })
}

export async function kaneoRemoveRelation(
  config: KaneoConfig,
  taskId: string,
  relatedTaskId: string,
): Promise<{ taskId: string; relatedTaskId: string }> {
  const result = await removeTaskRelation({ config, taskId, relatedTaskId })
  return { taskId: result.taskId, relatedTaskId: result.relatedTaskId }
}
