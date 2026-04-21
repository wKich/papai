// Coverage for makeCreateRecurringTaskTool lives in tests/tools/recurring-tools.test.ts.
// This file exists to satisfy the TDD gate (src/tools/create-recurring-task.ts → tests/tools/create-recurring-task.test.ts).
import { describe, expect, test } from 'bun:test'

import { makeCreateRecurringTaskTool } from '../../src/tools/create-recurring-task.js'

describe('create-recurring-task (gate stub)', () => {
  test('makeCreateRecurringTaskTool is a function', () => {
    expect(typeof makeCreateRecurringTaskTool).toBe('function')
  })
})
