import { archiveProject } from '../../src/kaneo/archive-project.js'
import { type KaneoConfig } from '../../src/kaneo/client.js'
import { createProject } from '../../src/kaneo/create-project.js'
import { deleteTask } from '../../src/kaneo/delete-task.js'
import { logger } from '../../src/logger.js'
import { getE2EConfig, type E2EConfig } from './setup.js'

const log = logger.child({ scope: 'e2e:client' })

export class KaneoTestClient {
  private readonly config: E2EConfig
  private readonly kaneoConfig: KaneoConfig
  private readonly createdProjectIds: string[]
  private readonly createdTaskIds: string[]

  constructor() {
    this.config = getE2EConfig()
    this.kaneoConfig = {
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
    }
    this.createdProjectIds = []
    this.createdTaskIds = []
  }

  async createTestProject(name: string): Promise<{ id: string; name: string; slug: string }> {
    log.debug({ name }, 'createTestProject called')

    const project = await createProject({
      config: this.kaneoConfig,
      workspaceId: this.config.workspaceId,
      name,
    })

    this.createdProjectIds.push(project.id)
    log.info({ projectId: project.id, name }, 'Test project created')

    return project
  }

  trackTask(taskId: string): void {
    this.createdTaskIds.push(taskId)
    log.debug({ taskId }, 'Task tracked for cleanup')
  }

  getKaneoConfig(): KaneoConfig {
    return { ...this.kaneoConfig }
  }

  getWorkspaceId(): string {
    return this.config.workspaceId
  }

  async cleanup(): Promise<void> {
    const projectCount = this.createdProjectIds.length
    const taskCount = this.createdTaskIds.length

    log.info({ projectCount, taskCount }, 'Starting cleanup')

    for (const taskId of this.createdTaskIds) {
      try {
        await deleteTask({ config: this.kaneoConfig, taskId })
        log.debug({ taskId }, 'Task deleted during cleanup')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn({ taskId, error: message }, 'Failed to delete task during cleanup')
      }
    }

    for (const projectId of this.createdProjectIds) {
      try {
        await archiveProject({ config: this.kaneoConfig, projectId })
        log.debug({ projectId }, 'Project archived during cleanup')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn({ projectId, error: message }, 'Failed to archive project during cleanup')
      }
    }

    this.createdTaskIds.length = 0
    this.createdProjectIds.length = 0

    log.info({ projectCount, taskCount }, 'Cleanup complete')
  }
}

export function createTestClient(): KaneoTestClient {
  return new KaneoTestClient()
}
