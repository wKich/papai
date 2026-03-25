import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import { mockLogger, mockDrizzle, setupTestDb } from '../utils/test-helpers.js'

mockLogger()
mockDrizzle()

import { setConfig } from '../../src/config.js'
import { makeDeferredPromptTools } from '../../src/deferred-prompts/tools.js'

const USER_ID = 'user-1'
const toolCtx = { toolCallId: 'tc1', messages: [] as never[], abortSignal: new AbortController().signal }

function getTools(): ReturnType<typeof makeDeferredPromptTools> {
  return makeDeferredPromptTools(USER_ID)
}

/** Build a fire_at object for 1 hour in the future (UTC, since tests set timezone=UTC). */
function futureFireAt(): { date: string; time: string } {
  const future = new Date(Date.now() + 3_600_000)
  const date = future.toISOString().slice(0, 10)
  const time = future.toISOString().slice(11, 16)
  return { date, time }
}

function extractId(result: unknown): string {
  if (typeof result !== 'object' || result === null || !('id' in result)) {
    throw new Error('Expected result with id property')
  }
  const id: unknown = Reflect.get(result, 'id')
  if (typeof id !== 'string') throw new Error('Expected id to be string')
  return id
}

function extractPrompts(result: unknown): unknown[] {
  if (typeof result !== 'object' || result === null || !('prompts' in result)) {
    throw new Error('Expected result with prompts property')
  }
  const prompts: unknown = Reflect.get(result, 'prompts')
  if (!Array.isArray(prompts)) throw new Error('Expected prompts to be array')
  return prompts
}

beforeEach(async () => {
  await setupTestDb()
  setConfig(USER_ID, 'timezone', 'UTC')
})

afterAll(() => {
  mock.restore()
})

describe('makeDeferredPromptTools', () => {
  test('exposes all 5 tools', () => {
    const names = Object.keys(getTools())
    expect(names).toContain('create_deferred_prompt')
    expect(names).toContain('list_deferred_prompts')
    expect(names).toContain('get_deferred_prompt')
    expect(names).toContain('update_deferred_prompt')
    expect(names).toContain('cancel_deferred_prompt')
    expect(names).toHaveLength(5)
  })
})

describe('create_deferred_prompt', () => {
  test('creates with schedule (returns type scheduled)', async () => {
    const t = getTools()['create_deferred_prompt']!
    if (!t.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await t.execute({ prompt: 'Remind me', schedule: { fire_at: futureFireAt() } }, toolCtx)
    expect(result).toHaveProperty('status', 'created')
    expect(result).toHaveProperty('type', 'scheduled')
    expect(result).toHaveProperty('id')
    expect(result).toHaveProperty('fireAt')
  })

  test('creates with cron-only schedule', async () => {
    const t = getTools()['create_deferred_prompt']!
    if (!t.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await t.execute({ prompt: 'Daily', schedule: { cron: '0 9 * * *' } }, toolCtx)
    expect(result).toHaveProperty('status', 'created')
    expect(result).toHaveProperty('type', 'scheduled')
    expect(result).toHaveProperty('cronExpression', '0 9 * * *')
  })

  test('creates with condition (returns type alert)', async () => {
    const t = getTools()['create_deferred_prompt']!
    if (!t.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await t.execute(
      {
        prompt: 'Urgent',
        condition: { field: 'task.priority', op: 'changed_to', value: 'urgent' },
        cooldown_minutes: 30,
      },
      toolCtx,
    )
    expect(result).toHaveProperty('status', 'created')
    expect(result).toHaveProperty('type', 'alert')
    expect(result).toHaveProperty('cooldownMinutes', 30)
  })

  test('rejects both schedule and condition', async () => {
    const t = getTools()['create_deferred_prompt']!
    if (!t.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await t.execute(
      {
        prompt: 'X',
        schedule: { fire_at: futureFireAt() },
        condition: { field: 'task.status', op: 'eq', value: 'done' },
      },
      toolCtx,
    )
    expect(result).toHaveProperty('error')
  })

  test('rejects neither schedule nor condition', async () => {
    const t = getTools()['create_deferred_prompt']!
    if (!t.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await t.execute({ prompt: 'X' }, toolCtx)
    expect(result).toHaveProperty('error')
  })

  test('rejects past fire_at', async () => {
    const t = getTools()['create_deferred_prompt']!
    if (!t.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await t.execute(
      { prompt: 'X', schedule: { fire_at: { date: '2020-01-01', time: '00:00' } } },
      toolCtx,
    )
    expect(result).toHaveProperty('error')
  })

  test('rejects invalid cron', async () => {
    const t = getTools()['create_deferred_prompt']!
    if (!t.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await t.execute({ prompt: 'X', schedule: { cron: 'bad' } }, toolCtx)
    expect(result).toHaveProperty('error')
  })

  test('rejects empty schedule object', async () => {
    const t = getTools()['create_deferred_prompt']!
    if (!t.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await t.execute({ prompt: 'X', schedule: {} }, toolCtx)
    expect(result).toHaveProperty('error')
  })

  test('converts structured fire_at from local time to UTC', async () => {
    setConfig(USER_ID, 'timezone', 'Asia/Karachi')
    const t = getTools()['create_deferred_prompt']!
    if (!t.execute) throw new Error('Tool execute is undefined')

    // Use a date far in the future to avoid "must be future" check
    const result: unknown = await t.execute(
      { prompt: 'Remind me', schedule: { fire_at: { date: '2027-03-25', time: '17:00' } } },
      toolCtx,
    )

    expect(result).toHaveProperty('status', 'created')
    expect(result).toHaveProperty('type', 'scheduled')
    // The stored fireAt should be 12:00 UTC (17:00 - 5h offset)
    // But returned fireAt is converted back to local (17:00)
    expect(result).toHaveProperty('fireAt')
    if (typeof result !== 'object' || result === null || !('fireAt' in result)) throw new Error('Expected fireAt')
    expect(String(result.fireAt)).toContain('17:00:00')
  })
})

describe('list_deferred_prompts', () => {
  test('returns both types', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const list = tools['list_deferred_prompts']!
    if (!create.execute || !list.execute) throw new Error('Tool execute is undefined')
    await create.execute({ prompt: 'S', schedule: { fire_at: futureFireAt() } }, toolCtx)
    await create.execute({ prompt: 'A', condition: { field: 'task.status', op: 'eq', value: 'done' } }, toolCtx)
    expect(extractPrompts(await list.execute({}, toolCtx))).toHaveLength(2)
  })

  test('filters by type', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const list = tools['list_deferred_prompts']!
    if (!create.execute || !list.execute) throw new Error('Tool execute is undefined')
    await create.execute({ prompt: 'S', schedule: { fire_at: futureFireAt() } }, toolCtx)
    await create.execute({ prompt: 'A', condition: { field: 'task.status', op: 'eq', value: 'done' } }, toolCtx)
    expect(extractPrompts(await list.execute({ type: 'scheduled' }, toolCtx))).toHaveLength(1)
    expect(extractPrompts(await list.execute({ type: 'alert' }, toolCtx))).toHaveLength(1)
  })
})

describe('get_deferred_prompt', () => {
  test('retrieves a prompt by ID', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const get = tools['get_deferred_prompt']!
    if (!create.execute || !get.execute) throw new Error('Tool execute is undefined')
    const created: unknown = await create.execute(
      { prompt: 'Fetch me', schedule: { fire_at: futureFireAt() } },
      toolCtx,
    )
    const result: unknown = await get.execute({ id: extractId(created) }, toolCtx)
    expect(result).toHaveProperty('type', 'scheduled')
    expect(result).toHaveProperty('prompt', 'Fetch me')
  })

  test('returns error for non-existent ID', async () => {
    const get = getTools()['get_deferred_prompt']!
    if (!get.execute) throw new Error('Tool execute is undefined')
    expect(await get.execute({ id: 'non-existent' }, toolCtx)).toHaveProperty('error')
  })
})

describe('update_deferred_prompt', () => {
  test('changes prompt text', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const update = tools['update_deferred_prompt']!
    if (!create.execute || !update.execute) throw new Error('Tool execute is undefined')
    const created: unknown = await create.execute(
      { prompt: 'Original', schedule: { fire_at: futureFireAt() } },
      toolCtx,
    )
    const result: unknown = await update.execute({ id: extractId(created), prompt: 'Updated text' }, toolCtx)
    expect(result).toHaveProperty('status', 'updated')
    expect(result).toHaveProperty('prompt', 'Updated text')
  })

  test('changes alert prompt text', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const update = tools['update_deferred_prompt']!
    if (!create.execute || !update.execute) throw new Error('Tool execute is undefined')
    const created: unknown = await create.execute(
      { prompt: 'Original', condition: { field: 'task.status', op: 'eq', value: 'done' } },
      toolCtx,
    )
    const result: unknown = await update.execute({ id: extractId(created), prompt: 'Updated alert' }, toolCtx)
    expect(result).toHaveProperty('status', 'updated')
    expect(result).toHaveProperty('prompt', 'Updated alert')
  })

  test('rejects condition on scheduled prompt', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const update = tools['update_deferred_prompt']!
    if (!create.execute || !update.execute) throw new Error('Tool execute is undefined')
    const created: unknown = await create.execute({ prompt: 'S', schedule: { fire_at: futureFireAt() } }, toolCtx)
    const result: unknown = await update.execute(
      { id: extractId(created), condition: { field: 'task.status', op: 'eq', value: 'done' } },
      toolCtx,
    )
    expect(result).toHaveProperty('error')
  })

  test('rejects schedule on alert prompt', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const update = tools['update_deferred_prompt']!
    if (!create.execute || !update.execute) throw new Error('Tool execute is undefined')
    const created: unknown = await create.execute(
      { prompt: 'A', condition: { field: 'task.status', op: 'eq', value: 'done' } },
      toolCtx,
    )
    const result: unknown = await update.execute(
      { id: extractId(created), schedule: { fire_at: futureFireAt() } },
      toolCtx,
    )
    expect(result).toHaveProperty('error')
  })

  test('returns error for non-existent ID', async () => {
    const update = getTools()['update_deferred_prompt']!
    if (!update.execute) throw new Error('Tool execute is undefined')
    expect(await update.execute({ id: 'missing', prompt: 'X' }, toolCtx)).toHaveProperty('error')
  })

  test('rejects past fire_at on update', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const update = tools['update_deferred_prompt']!
    if (!create.execute || !update.execute) throw new Error('Tool execute is undefined')
    const created: unknown = await create.execute({ prompt: 'S', schedule: { fire_at: futureFireAt() } }, toolCtx)
    const result: unknown = await update.execute(
      { id: extractId(created), schedule: { fire_at: { date: '2020-01-01', time: '00:00' } } },
      toolCtx,
    )
    expect(result).toHaveProperty('error')
  })
})

describe('cancel_deferred_prompt', () => {
  test('cancels a prompt', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const cancel = tools['cancel_deferred_prompt']!
    const get = tools['get_deferred_prompt']!
    if (!create.execute || !cancel.execute || !get.execute) throw new Error('Tool execute is undefined')
    const created: unknown = await create.execute(
      { prompt: 'Cancel me', schedule: { fire_at: futureFireAt() } },
      toolCtx,
    )
    const id = extractId(created)
    const result: unknown = await cancel.execute({ id }, toolCtx)
    expect(result).toHaveProperty('status', 'cancelled')
    expect(result).toHaveProperty('id', id)
    expect(await get.execute({ id }, toolCtx)).toHaveProperty('status', 'cancelled')
  })

  test('returns error for non-existent ID', async () => {
    const cancel = getTools()['cancel_deferred_prompt']!
    if (!cancel.execute) throw new Error('Tool execute is undefined')
    expect(await cancel.execute({ id: 'non-existent' }, toolCtx)).toHaveProperty('error')
  })
})
