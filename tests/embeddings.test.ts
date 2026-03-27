import { afterAll, mock, describe, expect, test } from 'bun:test'

import { mockLogger } from './utils/test-helpers.js'

mockLogger()

type EmbedResult = { embedding: number[] }
let embedImpl = (): Promise<EmbedResult> => Promise.resolve({ embedding: [0.1, 0.2, 0.3] })

void mock.module('ai', () => ({
  embed: (..._args: unknown[]): Promise<EmbedResult> => embedImpl(),
}))

type MockProvider = { embeddingModel: (name: string) => string }
void mock.module('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: (): MockProvider => ({
    embeddingModel: (name: string): string => name,
  }),
}))

import { getEmbedding, tryGetEmbedding } from '../src/embeddings.js'

afterAll(() => {
  mock.restore()
})

describe('getEmbedding', () => {
  test('returns embedding array from embed()', async () => {
    embedImpl = (): Promise<EmbedResult> => Promise.resolve({ embedding: [0.5, 0.6, 0.7] })
    const result = await getEmbedding('test text', 'key', 'http://localhost', 'model')
    expect(result).toEqual([0.5, 0.6, 0.7])
  })

  test('rethrows errors from embed()', async () => {
    embedImpl = (): Promise<EmbedResult> => Promise.reject(new Error('API error'))
    await expect(getEmbedding('test', 'key', 'http://localhost', 'model')).rejects.toThrow('API error')
  })
})

describe('tryGetEmbedding', () => {
  test('returns embedding on success', async () => {
    embedImpl = (): Promise<EmbedResult> => Promise.resolve({ embedding: [1, 2, 3] })
    const result = await tryGetEmbedding('test', 'key', 'http://localhost', 'model')
    expect(result).toEqual([1, 2, 3])
  })

  test('returns null when embed() throws', async () => {
    embedImpl = (): Promise<EmbedResult> => Promise.reject(new Error('Network error'))
    const result = await tryGetEmbedding('test', 'key', 'http://localhost', 'model')
    expect(result).toBeNull()
  })
})
