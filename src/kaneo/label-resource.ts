import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoLabelSchema, kaneoFetch } from './client.js'

const KaneoLabelWithTaskSchema = KaneoLabelSchema.extend({
  taskId: z.string().optional(),
})

export class LabelResource {
  private log = logger.child({ scope: 'kaneo:label-resource' })

  constructor(private config: KaneoConfig) {}

  async create(params: {
    workspaceId: string
    name: string
    color?: string
  }): Promise<z.infer<typeof KaneoLabelSchema>> {
    this.log.debug({ workspaceId: params.workspaceId, name: params.name }, 'Creating label')

    try {
      const label = await kaneoFetch(
        this.config,
        'POST',
        '/label',
        {
          name: params.name,
          color: params.color ?? '#6b7280',
          workspaceId: params.workspaceId,
        },
        undefined,
        KaneoLabelSchema,
      )
      this.log.info({ labelId: label.id, name: label.name }, 'Label created')
      return label
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to create label')
      throw classifyKaneoError(error)
    }
  }

  async list(workspaceId: string): Promise<z.infer<typeof KaneoLabelSchema>[]> {
    this.log.debug({ workspaceId }, 'Listing labels')

    try {
      const labels = await kaneoFetch(
        this.config,
        'GET',
        `/label/workspace/${workspaceId}`,
        undefined,
        undefined,
        z.array(KaneoLabelSchema),
      )
      this.log.info({ count: labels.length }, 'Labels listed')
      return labels
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list labels')
      throw classifyKaneoError(error)
    }
  }

  async update(labelId: string, params: { name?: string; color?: string }): Promise<z.infer<typeof KaneoLabelSchema>> {
    this.log.debug({ labelId, ...params }, 'Updating label')

    try {
      const body: Record<string, string> = {}
      if (params.name !== undefined) body['name'] = params.name
      if (params.color !== undefined) body['color'] = params.color

      const label = await kaneoFetch(this.config, 'PUT', `/label/${labelId}`, body, undefined, KaneoLabelSchema)
      this.log.info({ labelId, name: label.name }, 'Label updated')
      return label
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to update label')
      throw classifyKaneoError(error)
    }
  }

  async remove(labelId: string): Promise<{ id: string; success: true }> {
    this.log.debug({ labelId }, 'Removing label')

    try {
      await kaneoFetch(this.config, 'DELETE', `/label/${labelId}`, undefined, undefined, z.unknown())
      this.log.info({ labelId }, 'Label removed')
      return { id: labelId, success: true }
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to remove label')
      throw classifyKaneoError(error)
    }
  }

  async addToTask(taskId: string, labelId: string, workspaceId: string): Promise<{ taskId: string; labelId: string }> {
    this.log.debug({ taskId, labelId }, 'Adding label to task')

    try {
      const label = await kaneoFetch(this.config, 'GET', `/label/${labelId}`, undefined, undefined, KaneoLabelSchema)

      await kaneoFetch(
        this.config,
        'POST',
        '/label',
        {
          name: label.name,
          color: label.color,
          workspaceId,
          taskId,
        },
        undefined,
        KaneoLabelWithTaskSchema,
      )

      this.log.info({ taskId, labelId }, 'Label added to task')
      return { taskId, labelId }
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to add label to task')
      throw classifyKaneoError(error)
    }
  }

  async removeFromTask(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string; success: true }> {
    this.log.debug({ taskId, labelId }, 'Removing label from task')

    try {
      const taskLabels = await kaneoFetch(
        this.config,
        'GET',
        `/label/task/${taskId}`,
        undefined,
        undefined,
        z.array(KaneoLabelSchema),
      )
      const matchingLabel = taskLabels.find((l) => l.id === labelId)

      if (matchingLabel !== undefined) {
        await kaneoFetch(this.config, 'DELETE', `/label/${matchingLabel.id}`, undefined, undefined, z.unknown())
      }

      this.log.info({ taskId, labelId }, 'Label removed from task')
      return { taskId, labelId, success: true }
    } catch (error) {
      this.log.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to remove label from task',
      )
      throw classifyKaneoError(error)
    }
  }
}
