import type { LanguageModel, ModelMessage } from 'ai'
import { describe, expect, it } from 'bun:test'
import { executeLookupGroupHistory } from '../../src/tools/lookup-group-history.js'

type GenerateTextResult = {
  text: string
}

describe('executeLookupGroupHistory', () => {
  it('should return empty message when no history', async () => {
    const mockGetHistory = (): readonly ModelMessage[] => []
    const result = await executeLookupGroupHistory(
      'user123',
      'group456',
      ['test query'],
      {
        getCachedHistory: mockGetHistory,
        generateText: async (): Promise<GenerateTextResult> => ({ text: 'test' }),
        getSmallModel: () => ({}) as unknown as LanguageModel,
      }
    )
    expect(result).toBe('No messages found in the main chat.')
  })
})

describe('executeLookupGroupHistory with history', () => {
  it('should return LLM response when history exists', async () => {
    const mockHistory: ModelMessage[] = [
      { role: 'user', content: 'What about the API?' },
      { role: 'assistant', content: 'We decided to use REST' },
    ]

    const result = await executeLookupGroupHistory(
      'user123',
      'group456',
      ['API decision'],
      {
        getCachedHistory: () => mockHistory,
        generateText: async (): Promise<GenerateTextResult> => ({ text: 'The team decided to use REST for the API.' }),
        getSmallModel: () => ({}) as unknown as LanguageModel,
      }
    )
    expect(result).toBe('The team decided to use REST for the API.')
  })

  it('should return error when LLM not configured', async () => {
    const result = await executeLookupGroupHistory(
      'user123',
      'group456',
      ['test'],
      {
        getCachedHistory: () => [{ role: 'user', content: 'test' }],
        generateText: async (): Promise<GenerateTextResult> => ({ text: '' }),
        getSmallModel: () => null,
      }
    )
    expect(result).toBe('Unable to search: LLM not configured.')
  })

  it('should handle LLM errors gracefully', async () => {
    const result = await executeLookupGroupHistory(
      'user123',
      'group456',
      ['test'],
      {
        getCachedHistory: () => [{ role: 'user', content: 'test' }],
        generateText: async (): Promise<GenerateTextResult> => { throw new Error('LLM error') },
        getSmallModel: () => ({}) as unknown as LanguageModel,
      }
    )
    expect(result).toBe('Error searching main chat history.')
  })
})
