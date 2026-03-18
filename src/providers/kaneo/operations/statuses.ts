import type { Column } from '../../types.js'
import { createColumn, deleteColumn, listColumns, reorderColumns, updateColumn } from '../api.js'
import type { KaneoConfig } from '../client.js'
import { mapColumn } from '../mappers.js'

export async function kaneoListStatuses(config: KaneoConfig, projectId: string): Promise<Column[]> {
  const results = await listColumns({ config, projectId })
  return results.map(mapColumn)
}

export async function kaneoCreateStatus(
  config: KaneoConfig,
  projectId: string,
  params: { name: string; icon?: string; color?: string; isFinal?: boolean },
): Promise<Column> {
  const result = await createColumn({ config, projectId, ...params })
  return mapColumn(result)
}

export async function kaneoUpdateStatus(
  config: KaneoConfig,
  statusId: string,
  params: { name?: string; icon?: string; color?: string; isFinal?: boolean },
): Promise<Column> {
  const result = await updateColumn({ config, columnId: statusId, ...params })
  return mapColumn(result)
}

export async function kaneoDeleteStatus(config: KaneoConfig, statusId: string): Promise<{ id: string }> {
  const result = await deleteColumn({ config, columnId: statusId })
  return { id: result.id }
}

export async function kaneoReorderStatuses(
  config: KaneoConfig,
  projectId: string,
  statuses: { id: string; position: number }[],
): Promise<void> {
  await reorderColumns({ config, projectId, columns: statuses })
}
