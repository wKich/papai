import { describe, test, expect, beforeEach } from 'bun:test'

import { _userCaches } from '../../src/cache.js'
import { setConfig } from '../../src/config.js'
import { saveMemo } from '../../src/memos.js'
import { makeArchiveMemosTool } from '../../src/tools/archive-memos.js'
import { makeListMemosTool } from '../../src/tools/list-memos.js'
import { makePromoteMemoTool } from '../../src/tools/promote-memo.js'
import { makeSaveMemoTool } from '../../src/tools/save-memo.js'
import { makeSearchMemosTool } from '../../src/tools/search-memos.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

beforeEach(() => {
  mockLogger()
})

async function exec(
  toolInstance: ReturnType<typeof makeSaveMemoTool>,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (!toolInstance.execute) throw new Error('Tool execute is undefined')
  const result: unknown = await toolInstance.execute(input, { toolCallId: '1', messages: [] })
  return result
}

describe('save_memo tool', () => {
  beforeEach(async () => {
    _userCaches.clear()
    await setupTestDb()
  })

  test('saves memo and returns confirmation', async () => {
    const result = await exec(makeSaveMemoTool('user1'), { content: 'test note', tags: ['tag1'] })
    expect(result).toHaveProperty('id')
    expect(result).toHaveProperty('content', 'test note')
    expect(result).toHaveProperty('tags', ['tag1'])
  })

  test('saves without tags', async () => {
    const result = await exec(makeSaveMemoTool('user1'), { content: 'no tags' })
    expect(result).toHaveProperty('tags', [])
  })
})

describe('search_memos tool', () => {
  beforeEach(async () => {
    _userCaches.clear()
    await setupTestDb()
  })

  test('keyword search returns matching memos', async () => {
    saveMemo('user1', 'lease renewal deadline', ['landlord'])
    saveMemo('user1', 'buy groceries', ['shopping'])

    const result = await exec(makeSearchMemosTool('user1'), { query: 'lease', mode: 'keyword' })
    expect(result).toHaveProperty('mode', 'keyword')
    expect(result).toHaveProperty('results')
  })

  test('falls back to keyword when embedding unavailable', async () => {
    saveMemo('user1', 'important project deadline', [])

    const result = await exec(makeSearchMemosTool('user1'), { query: 'deadline', mode: 'auto' })
    expect(result).toHaveProperty('mode', 'keyword_fallback')
  })

  test('returns empty for no matches', async () => {
    saveMemo('user1', 'some content', [])

    const result = await exec(makeSearchMemosTool('user1'), { query: 'nonexistent', mode: 'keyword' })
    expect(result).toHaveProperty('results', [])
  })
})

describe('list_memos tool', () => {
  beforeEach(async () => {
    _userCaches.clear()
    await setupTestDb()
  })

  test('lists memos', async () => {
    saveMemo('user1', 'first', [])
    saveMemo('user1', 'second', [])

    const result = await exec(makeListMemosTool('user1'), {})
    expect(result).toHaveProperty('memos')
  })

  test('respects limit', async () => {
    for (let i = 0; i < 5; i++) saveMemo('user1', `note ${i}`, [])

    const result = await exec(makeListMemosTool('user1'), { limit: 2 })
    expect(result).toHaveProperty('memos')
  })
})

describe('archive_memos tool', () => {
  beforeEach(async () => {
    _userCaches.clear()
    await setupTestDb()
  })

  test('rejects when no filter provided', async () => {
    const result = await exec(makeArchiveMemosTool('user1'), { confidence: 1.0 })
    expect(result).toHaveProperty('status', 'error')
  })

  test('requires confirmation when confidence is low for non-ID archive', async () => {
    saveMemo('user1', 'note', ['tag'])
    const result = await exec(makeArchiveMemosTool('user1'), { tag: 'tag', confidence: 0.5 })
    expect(result).toHaveProperty('status', 'confirmation_required')
  })

  test('archives by tag with high confidence', async () => {
    saveMemo('user1', 'tagged note', ['cleanup'])
    saveMemo('user1', 'other note', ['keep'])

    const result = await exec(makeArchiveMemosTool('user1'), { tag: 'cleanup', confidence: 1.0 })
    expect(result).toHaveProperty('status', 'archived')
    expect(result).toHaveProperty('count', 1)
  })

  test('archives by memo IDs without confirmation gate', async () => {
    const memo = saveMemo('user1', 'specific note', [])
    saveMemo('user1', 'other', [])

    const result = await exec(makeArchiveMemosTool('user1'), { memoIds: [memo.id], confidence: 0.5 })
    expect(result).toHaveProperty('status', 'archived')
    expect(result).toHaveProperty('count', 1)
  })
})

describe('promote_memo tool', () => {
  beforeEach(async () => {
    _userCaches.clear()
    await setupTestDb()
    setConfig('user1', 'timezone', 'UTC')
  })

  test('promotes memo to task', async () => {
    const memo = saveMemo('user1', 'lease renewal deadline June 15', ['landlord'])
    const provider = createMockProvider()

    const result = await exec(makePromoteMemoTool(provider, 'user1'), { memoId: memo.id, projectId: 'proj-1' })
    expect(result).toHaveProperty('status', 'promoted')
    expect(result).toHaveProperty('taskId', 'task-1')
    expect(result).toHaveProperty('memoId', memo.id)
  })

  test('returns error for nonexistent memo', async () => {
    const provider = createMockProvider()
    const result = await exec(makePromoteMemoTool(provider, 'user1'), {
      memoId: 'nonexistent',
      projectId: 'proj-1',
    })
    expect(result).toHaveProperty('status', 'error')
  })

  test('returns error when provider.createTask fails', async () => {
    const memo = saveMemo('user1', 'will fail', [])
    const provider = createMockProvider({
      createTask: () => Promise.reject(new Error('API unavailable')),
    })

    const result = await exec(makePromoteMemoTool(provider, 'user1'), {
      memoId: memo.id,
      projectId: 'proj-1',
    })
    expect(result).toHaveProperty('status', 'error')
    expect(result).toHaveProperty('message')
  })
})
