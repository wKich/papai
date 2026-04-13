import { describe, test } from 'bun:test'

import * as commands from '../../src/commands/index.js'

describe('commands/index exports', () => {
  test('exports registerContextCommand', () => {
    if (typeof commands.registerContextCommand !== 'function') {
      throw new Error('registerContextCommand not exported')
    }
  })
})
