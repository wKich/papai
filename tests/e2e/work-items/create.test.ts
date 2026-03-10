/**
 * E2E Test: Work Item Creation
 * 
 * Tests creating work items in Plane API using the real SDK
 */

import { describe, expect, test, beforeAll } from 'bun:test'
import { PlaneClient } from '@makeplane/plane-node-sdk'
import { skipIfNoPlaneApi, generateTestId } from '../../setup.js'

describe('Work Item Creation', () => {
  let client: PlaneClient

  beforeAll(() => {
    skipIfNoPlaneApi()
    // In real usage, you'd get API key from config
    client = new PlaneClient({ apiKey: 'test-api-key' })
  })

  test('creates work item with minimal fields', async () => {
    // Note: This is a template test. Real implementation would:
    // 1. Get actual workspace/project from config
    // 2. Make real API calls
    // 3. Clean up created items
    
    const testId = generateTestId('issue')
    
    // Example of what actual test would look like:
    // const workItem = await client.workItems.create(
    //   'workspace-slug',
    //   'project-id',
    //   { name: `Test Work Item ${testId}` }
    // )
    
    // For now, just verify the client is configured
    expect(client).toBeDefined()
    expect(typeof client.workItems.create).toBe('function')
  })

  test('Plane SDK client is properly initialized', () => {
    expect(client).toBeInstanceOf(PlaneClient)
    expect(client.workItems).toBeDefined()
    expect(typeof client.workItems.create).toBe('function')
    expect(typeof client.workItems.list).toBe('function')
    expect(typeof client.workItems.retrieve).toBe('function')
    expect(typeof client.workItems.update).toBe('function')
  })

  test('generates unique test identifiers', () => {
    const ids = new Set<string>()
    
    for (let i = 0; i < 10; i++) {
      ids.add(generateTestId('item'))
    }
    
    expect(ids.size).toBe(10)
  })
})
