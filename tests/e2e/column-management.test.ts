import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import type { KaneoConfig } from '../../src/kaneo/client.js'
import { createColumn } from '../../src/kaneo/create-column.js'
import { deleteColumn } from '../../src/kaneo/delete-column.js'
import { listColumns } from '../../src/kaneo/list-columns.js'
import { reorderColumns } from '../../src/kaneo/reorder-columns.js'
import { updateColumn } from '../../src/kaneo/update-column.js'
import { createTestClient, type KaneoTestClient } from './kaneo-test-client.js'
import { setupE2EEnvironment, teardownE2EEnvironment } from './setup.js'

describe('E2E: Column Management', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let projectId: string
  const createdColumnIds: string[] = []

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

    // Clean up columns - sequential is intentional to handle individual errors
    for (const columnId of createdColumnIds) {
      try {
        await deleteColumn({ config: kaneoConfig, columnId })
      } catch {
        /* ignore */
      }
    }
    createdColumnIds.length = 0

    const project = await testClient.createTestProject(`Column Test ${Date.now()}`)
    projectId = project.id
  })

  test('creates a column with all properties', async () => {
    const column = await createColumn({
      config: kaneoConfig,
      projectId,
      name: 'In Review',
      icon: '👀',
      color: '#FFA500',
      isFinal: false,
    })
    createdColumnIds.push(column.id)

    expect(column.name).toBe('In Review')
    expect(column.icon).toBe('👀')
    expect(column.color).toBe('#FFA500')
    expect(column.isFinal).toBe(false)
  })

  test('creates a final column', async () => {
    const column = await createColumn({
      config: kaneoConfig,
      projectId,
      name: 'Done',
      isFinal: true,
    })
    createdColumnIds.push(column.id)

    expect(column.isFinal).toBe(true)
  })

  test('lists columns in project', async () => {
    // Create some custom columns
    const col1 = await createColumn({ config: kaneoConfig, projectId, name: 'Backlog' })
    const col2 = await createColumn({ config: kaneoConfig, projectId, name: 'In Progress' })
    createdColumnIds.push(col1.id, col2.id)

    const columns = await listColumns({ config: kaneoConfig, projectId })

    expect(columns.length).toBeGreaterThanOrEqual(2)
    const names = columns.map((c) => c.name)
    expect(names).toContain('Backlog')
    expect(names).toContain('In Progress')
  })

  test('updates column name', async () => {
    const column = await createColumn({ config: kaneoConfig, projectId, name: 'Old Name' })
    createdColumnIds.push(column.id)

    const updated = await updateColumn({
      config: kaneoConfig,
      columnId: column.id,
      name: 'New Name',
    })

    expect(updated.name).toBe('New Name')
  })

  test('updates column color and icon', async () => {
    const column = await createColumn({ config: kaneoConfig, projectId, name: 'Status' })
    createdColumnIds.push(column.id)

    const updated = await updateColumn({
      config: kaneoConfig,
      columnId: column.id,
      color: '#00FF00',
      icon: '✅',
    })

    expect(updated.color).toBe('#00FF00')
    expect(updated.icon).toBe('✅')
  })

  test('reorders columns', async () => {
    const col1 = await createColumn({ config: kaneoConfig, projectId, name: 'First' })
    const col2 = await createColumn({ config: kaneoConfig, projectId, name: 'Second' })
    const col3 = await createColumn({ config: kaneoConfig, projectId, name: 'Third' })
    createdColumnIds.push(col1.id, col2.id, col3.id)

    // Reverse the order
    await reorderColumns({
      config: kaneoConfig,
      projectId,
      columns: [
        { id: col3.id, position: 0 },
        { id: col2.id, position: 1 },
        { id: col1.id, position: 2 },
      ],
    })

    const columns = await listColumns({ config: kaneoConfig, projectId })
    const customColumns = columns.filter((c) => [col1.id, col2.id, col3.id].includes(c.id))

    expect(customColumns[0]?.id).toBe(col3.id)
    expect(customColumns[1]?.id).toBe(col2.id)
    expect(customColumns[2]?.id).toBe(col1.id)
  })

  test('deletes a column', async () => {
    const column = await createColumn({ config: kaneoConfig, projectId, name: 'To Delete' })

    await deleteColumn({ config: kaneoConfig, columnId: column.id })

    const columns = await listColumns({ config: kaneoConfig, projectId })
    const found = columns.find((c) => c.id === column.id)
    expect(found).toBeUndefined()
  })

  test('creates column without optional properties', async () => {
    const column = await createColumn({ config: kaneoConfig, projectId, name: 'Simple Column' })
    createdColumnIds.push(column.id)

    expect(column.name).toBe('Simple Column')
    expect(column.id).toBeDefined()
  })
})
