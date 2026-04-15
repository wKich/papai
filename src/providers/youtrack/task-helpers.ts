import { z } from 'zod'

import { providerError } from '../../errors.js'
import type { ListTasksParams, Task } from '../types.js'
import { YouTrackClassifiedError } from './classify-error.js'
import type { YouTrackConfig } from './client.js'
import { youtrackFetch } from './client.js'
import { PROJECT_CUSTOM_FIELD_FIELDS, YOUTRACK_DUE_DATE_FIELD_NAME } from './constants.js'
import { paginate } from './helpers.js'
import { ProjectCustomFieldListSchema, ProjectCustomFieldSchema } from './schemas/bundle.js'

type ProjectCustomField = z.infer<typeof ProjectCustomFieldSchema>

type CreateIssueCustomFieldPayload = {
  name: string
  $type: 'SimpleIssueCustomField' | 'TextIssueCustomField'
  value: string | { text: string }
}

type StandardCustomFieldPayload = {
  name: string
  $type: string
  value: Record<string, string> | number
}

const KNOWN_CUSTOM_FIELDS = new Set(['State', 'Priority', 'Assignee'])

const DueDateCustomFieldSchema = z.object({
  name: z.string(),
  value: z.unknown().optional(),
})

const isDateOnlyValue = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value)

const isIsoDateTimeValue = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)

const normalizeCustomFieldType = (value: string | undefined): string | undefined => value?.trim().toLowerCase()

const isValidDateOnlyValue = (value: string): boolean => {
  if (!isDateOnlyValue(value)) return false
  const parsed = new Date(`${value}T12:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

const parseDueDateValue = (dueDate: string): number => {
  if (isValidDateOnlyValue(dueDate)) {
    return Date.parse(`${dueDate}T12:00:00.000Z`)
  }

  if (isDateOnlyValue(dueDate)) {
    throw new YouTrackClassifiedError(
      `Invalid dueDate: ${dueDate}`,
      providerError.validationFailed('dueDate', 'Expected a real calendar date in YYYY-MM-DD format'),
    )
  }

  if (isIsoDateTimeValue(dueDate)) {
    return Date.parse(`${dueDate.slice(0, 10)}T12:00:00.000Z`)
  }

  throw new YouTrackClassifiedError(
    `Invalid dueDate: ${dueDate}`,
    providerError.validationFailed('dueDate', 'Expected YYYY-MM-DD or an ISO datetime with timezone information'),
  )
}

const isStringSimpleProjectField = (field: ProjectCustomField): boolean => {
  if (field.$type !== 'SimpleProjectCustomField') return false

  const fieldTypeId = normalizeCustomFieldType(field.field?.fieldType?.id)
  const presentation = normalizeCustomFieldType(field.field?.fieldType?.presentation)
  return fieldTypeId === 'string' || presentation === 'string'
}

const isTextProjectField = (field: ProjectCustomField): boolean => field.$type === 'TextProjectCustomField'

const fetchProjectCustomFields = async (
  config: Readonly<YouTrackConfig>,
  projectId: string,
): Promise<ProjectCustomField[]> => {
  const raw = await youtrackFetch(config, 'GET', `/api/admin/projects/${projectId}/customFields`, {
    query: { fields: PROJECT_CUSTOM_FIELD_FIELDS },
  })
  return ProjectCustomFieldListSchema.parse(raw)
}

const buildProjectFieldsByName = (
  projectCustomFields: readonly ProjectCustomField[],
): Map<string, ProjectCustomField & { readonly field: { readonly name: string } }> =>
  new Map(
    projectCustomFields
      .filter(
        (field): field is ProjectCustomField & { readonly field: { readonly name: string } } =>
          field.field?.name !== undefined,
      )
      .map((field) => [field.field.name, field] as const),
  )

const buildHandledFieldSet = (
  projectFieldsByName: ReadonlyMap<string, ProjectCustomField & { readonly field: { readonly name: string } }>,
  customFields: ReadonlyArray<{ name: string; value: string }> | undefined,
): Set<string> => {
  const handledFields = new Set(KNOWN_CUSTOM_FIELDS)

  for (const fieldName of new Set((customFields ?? []).map((field) => field.name))) {
    const projectField = projectFieldsByName.get(fieldName)
    if (projectField === undefined) {
      throw new YouTrackClassifiedError(
        `Unknown custom field for create: ${fieldName}`,
        providerError.validationFailed(
          'customFields',
          `${fieldName} is not a known project field for this YouTrack project`,
        ),
      )
    }

    if (buildCreateIssueCustomField(projectField, '') === undefined) {
      throw new YouTrackClassifiedError(
        `Unsupported custom field for create: ${fieldName}`,
        providerError.validationFailed(
          'customFields',
          `${fieldName} is not a supported YouTrack string/text project field for create_task`,
        ),
      )
    }

    handledFields.add(fieldName)
  }

  return handledFields
}

export const mapYouTrackDueDateValue = (timestamp: number | null | undefined): string | undefined =>
  timestamp === undefined || timestamp === null ? undefined : new Date(timestamp).toISOString().slice(0, 10)

export const buildCustomFields = (
  params: Readonly<{
    status?: string
    priority?: string
    dueDate?: string
    assignee?: string
    customFields?: Array<{ name: string; value: string }>
  }>,
): StandardCustomFieldPayload[] => {
  const fields: StandardCustomFieldPayload[] = []
  if (params.priority !== undefined) {
    fields.push({ name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { name: params.priority } })
  }
  if (params.status !== undefined) {
    fields.push({ name: 'State', $type: 'StateIssueCustomField', value: { name: params.status } })
  }
  if (params.dueDate !== undefined) {
    fields.push({
      name: YOUTRACK_DUE_DATE_FIELD_NAME,
      $type: 'DateIssueCustomField',
      value: parseDueDateValue(params.dueDate),
    })
  }
  if (params.assignee !== undefined) {
    fields.push({ name: 'Assignee', $type: 'SingleUserIssueCustomField', value: { login: params.assignee } })
  }
  return fields
}

export const buildCreateIssueCustomField = (
  field: ProjectCustomField,
  value: string,
): CreateIssueCustomFieldPayload | undefined => {
  const name = field.field?.name
  if (name === undefined) return undefined

  if (isTextProjectField(field)) {
    return { name, $type: 'TextIssueCustomField', value: { text: value } }
  }

  if (isStringSimpleProjectField(field)) {
    return { name, $type: 'SimpleIssueCustomField', value }
  }

  return undefined
}

export const validateRequiredCreateFields = async (
  config: Readonly<YouTrackConfig>,
  projectId: string,
  projectShortName: string,
  dueDate: string | undefined,
  customFields: ReadonlyArray<{ name: string; value: string }> | undefined,
): Promise<ProjectCustomField[]> => {
  const projectCustomFields = await fetchProjectCustomFields(config, projectId)
  const handledFields = buildHandledFieldSet(buildProjectFieldsByName(projectCustomFields), customFields)

  if (dueDate !== undefined) {
    handledFields.add(YOUTRACK_DUE_DATE_FIELD_NAME)
  }

  const requiredFields = projectCustomFields
    .filter((field) => field.canBeEmpty === false)
    .map((field) => field.field?.name)
    .filter((fieldName): fieldName is string => fieldName !== undefined && !handledFields.has(fieldName))

  if (requiredFields.length === 0) return projectCustomFields

  throw new YouTrackClassifiedError(
    `Project ${projectShortName} requires these custom fields: ${requiredFields.join(', ')}`,
    providerError.workflowValidationFailed(
      projectId,
      'The project workflow requires additional custom fields before the task can be created.',
      requiredFields.map((name) => ({ name })),
    ),
  )
}

export const buildCreateCustomFields = (
  params: Readonly<{
    status?: string
    priority?: string
    dueDate?: string
    assignee?: string
    customFields?: Array<{ name: string; value: string }>
  }>,
  projectCustomFields: readonly ProjectCustomField[],
): Array<StandardCustomFieldPayload | CreateIssueCustomFieldPayload> => {
  const fields: Array<StandardCustomFieldPayload | CreateIssueCustomFieldPayload> = [...buildCustomFields(params)]
  const projectFieldsByName = new Map(projectCustomFields.map((field) => [field.field?.name, field] as const))

  for (const field of params.customFields ?? []) {
    const projectField = projectFieldsByName.get(field.name)
    const mappedField = projectField === undefined ? undefined : buildCreateIssueCustomField(projectField, field.value)
    if (mappedField !== undefined) {
      fields.push(mappedField)
    }
  }

  return fields
}

export const buildYouTrackQuery = (params: Readonly<ListTasksParams> | undefined, projectShortName: string): string => {
  const queryParts: string[] = [`project: {${projectShortName}}`]

  if (params?.status !== undefined) queryParts.push(`State: {${params.status}}`)
  if (params?.priority !== undefined) queryParts.push(`Priority: {${params.priority}}`)
  if (params?.assigneeId !== undefined) queryParts.push(`Assignee: {${params.assigneeId}}`)

  if (params?.dueAfter !== undefined && params.dueBefore !== undefined) {
    queryParts.push(`Due date: >${params.dueAfter}`)
    queryParts.push(`Due date: <${params.dueBefore}`)
  } else if (params?.dueAfter !== undefined) {
    queryParts.push(`Due date: >${params.dueAfter}`)
  } else if (params?.dueBefore !== undefined) {
    queryParts.push(`Due date: <${params.dueBefore}`)
  }

  if (params?.sortBy !== undefined) {
    const sortField = params.sortBy === 'createdAt' ? 'created' : params.sortBy
    queryParts.push(`sort by: ${sortField} ${params.sortOrder ?? 'asc'}`)
  }

  return queryParts.join(' ')
}

export const enrichTaskWithDueDate = async (config: Readonly<YouTrackConfig>, task: Readonly<Task>): Promise<Task> => {
  try {
    const customFields = await paginate(
      config,
      `/api/issues/${task.id}/customFields`,
      { fields: 'name,value' },
      DueDateCustomFieldSchema.array(),
    )
    const dueDateField = customFields.find((field) => field.name === YOUTRACK_DUE_DATE_FIELD_NAME)
    const dueDate = typeof dueDateField?.value === 'number' ? mapYouTrackDueDateValue(dueDateField.value) : undefined
    return dueDate === undefined ? { ...task, dueDate: task.dueDate ?? null } : { ...task, dueDate }
  } catch {
    return { ...task }
  }
}
