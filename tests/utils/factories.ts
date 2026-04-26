import type { TaskProvider } from '../../src/providers/types.js'
import { localDatetimeToUtc, utcToLocal } from '../../src/utils/datetime.js'

export function createMinimalTaskProviderStub(overrides?: Partial<TaskProvider>): TaskProvider {
  return {
    name: 'mock',
    capabilities: new Set(),
    configRequirements: [],
    preferredUserIdentifier: 'id',
    buildTaskUrl: () => '',
    buildProjectUrl: () => '',
    classifyError: (e) => {
      throw e
    },
    getPromptAddendum: () => '',
    normalizeDueDateInput: (dueDate, timezone) =>
      dueDate === undefined ? undefined : localDatetimeToUtc(dueDate.date, dueDate.time, timezone),
    formatDueDateOutput: (dueDate, timezone) =>
      dueDate === undefined || dueDate === null ? dueDate : utcToLocal(dueDate, timezone),
    normalizeListTaskParams: (params) => ({ ...params }),
    createTask(): Promise<never> {
      throw new Error('not implemented')
    },
    getTask(): Promise<never> {
      throw new Error('not implemented')
    },
    updateTask(): Promise<never> {
      throw new Error('not implemented')
    },
    listTasks(): Promise<never> {
      throw new Error('not implemented')
    },
    searchTasks(): Promise<never> {
      throw new Error('not implemented')
    },
    ...overrides,
  }
}
