import { beforeEach, describe, expect, test } from 'bun:test'

import type { IncomingFile } from '../src/chat/types.js'
import { clearIncomingFiles, getIncomingFiles, storeIncomingFiles } from '../src/file-relay.js'

function makeFile(overrides: Partial<IncomingFile> = {}): IncomingFile {
  return {
    fileId: 'file-1',
    filename: 'test.txt',
    mimeType: 'text/plain',
    size: 100,
    content: Buffer.from('hello'),
    ...overrides,
  }
}

describe('file-relay', () => {
  beforeEach(() => {
    clearIncomingFiles('ctx-1')
    clearIncomingFiles('ctx-2')
  })

  describe('storeIncomingFiles / getIncomingFiles', () => {
    test('returns empty array when no files stored', () => {
      expect(getIncomingFiles('ctx-1')).toEqual([])
    })

    test('stores and retrieves files by contextId', () => {
      const files = [makeFile(), makeFile({ fileId: 'file-2', filename: 'other.pdf' })]
      storeIncomingFiles('ctx-1', files)
      expect(getIncomingFiles('ctx-1')).toEqual(files)
    })

    test('contexts are isolated', () => {
      storeIncomingFiles('ctx-1', [makeFile({ fileId: 'f1' })])
      storeIncomingFiles('ctx-2', [makeFile({ fileId: 'f2' })])

      expect(getIncomingFiles('ctx-1')[0]?.fileId).toBe('f1')
      expect(getIncomingFiles('ctx-2')[0]?.fileId).toBe('f2')
    })

    test('overwrite replaces previous files', () => {
      storeIncomingFiles('ctx-1', [makeFile({ fileId: 'old' })])
      storeIncomingFiles('ctx-1', [makeFile({ fileId: 'new' })])
      expect(getIncomingFiles('ctx-1')).toHaveLength(1)
      expect(getIncomingFiles('ctx-1')[0]?.fileId).toBe('new')
    })

    test('stores empty array (clears files)', () => {
      storeIncomingFiles('ctx-1', [makeFile()])
      storeIncomingFiles('ctx-1', [])
      expect(getIncomingFiles('ctx-1')).toEqual([])
    })
  })

  describe('clearIncomingFiles', () => {
    test('removes stored files', () => {
      storeIncomingFiles('ctx-1', [makeFile()])
      clearIncomingFiles('ctx-1')
      expect(getIncomingFiles('ctx-1')).toEqual([])
    })

    test('clearing non-existent context is safe', () => {
      expect(() => clearIncomingFiles('no-such-ctx')).not.toThrow()
    })
  })
})
