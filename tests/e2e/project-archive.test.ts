import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import { archiveProject } from '../../src/kaneo/archive-project.js'
import type { KaneoConfig } from '../../src/kaneo/client.js'
import { listProjects } from '../../src/kaneo/list-projects.js'
import { updateProject } from '../../src/kaneo/update-project.js'
import { createTestClient, type KaneoTestClient } from './kaneo-test-client.js'
import { setupE2EEnvironment, teardownE2EEnvironment } from './setup.js'

describe('E2E: Project Archive', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig

  beforeAll(async () => {
    await setupE2EEnvironment()
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
  })

  afterAll(async () => {
    await teardownE2EEnvironment()
  })

  beforeEach(async () => {
    await testClient.cleanup()
  })

  test('archives a project', async () => {
    const project = await testClient.createTestProject(`To Archive ${Date.now()}`)
    await archiveProject({ config: kaneoConfig, projectId: project.id })

    const projects = await listProjects({ config: kaneoConfig, workspaceId: testClient.getWorkspaceId() })
    const found = projects.find((p) => p.id === project.id)
    expect(found).toBeDefined()
  })

  test('updates project name and description', async () => {
    const project = await testClient.createTestProject(`To Update ${Date.now()}`)

    const updated = await updateProject({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
      projectId: project.id,
      name: 'Updated Project Name',
      description: 'Updated description',
    })

    expect(updated.name).toBe('Updated Project Name')
  })

  test('lists projects in workspace', async () => {
    const project1 = await testClient.createTestProject(`Project A ${Date.now()}`)
    const project2 = await testClient.createTestProject(`Project B ${Date.now()}`)

    const projects = await listProjects({ config: kaneoConfig, workspaceId: testClient.getWorkspaceId() })

    const ids = projects.map((p) => p.id)
    expect(ids).toContain(project1.id)
    expect(ids).toContain(project2.id)
  })
})
