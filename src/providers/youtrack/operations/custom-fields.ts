import { logger } from '../../../logger.js'
import { classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { ProjectCustomFieldSchema } from '../schemas/custom-fields.js'

const log = logger.child({ scope: 'provider:youtrack:custom-fields' })

/**
 * Get the list of required custom fields for a project.
 * Required fields are those where canBeEmpty is false.
 */
export async function getProjectRequiredFields(config: YouTrackConfig, projectId: string): Promise<string[]> {
  log.debug({ projectId }, 'getProjectRequiredFields')
  try {
    const raw = await youtrackFetch(config, 'GET', `/api/admin/projects/${projectId}/customFields`, {
      query: { fields: 'field(name),canBeEmpty' },
    })
    const customFields = ProjectCustomFieldSchema.array().parse(raw)
    const requiredFields = customFields.filter((field) => !field.canBeEmpty).map((field) => field.field.name)
    log.info({ projectId, requiredFields: requiredFields.length }, 'Retrieved required custom fields')
    return requiredFields
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), projectId },
      'Failed to get project required fields',
    )
    throw classifyYouTrackError(error, { projectId })
  }
}
