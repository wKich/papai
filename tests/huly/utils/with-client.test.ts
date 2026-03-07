import { describe, expect, it, mock } from 'bun:test'

import { withClient } from '../../../src/huly/utils/with-client.js'

class MockHulyClient {
  close = mock(() => Promise.resolve(undefined))
}

describe('withClient', () => {
  it('should call operation and close client on success', async () => {
    const mockClient = new MockHulyClient()
    const mockGetClient = mock(() => Promise.resolve(mockClient))
    const mockOperation = mock(() => Promise.resolve('result'))

    const result = await withClient(123, mockGetClient, mockOperation)

    expect(mockGetClient).toHaveBeenCalledWith(123)
    expect(mockOperation).toHaveBeenCalledWith(mockClient)
    expect(mockClient.close).toHaveBeenCalled()
    expect(result).toBe('result')
  })

  it('should close client even when operation throws', () => {
    const mockClient = new MockHulyClient()
    const mockGetClient = mock(() => Promise.resolve(mockClient))
    const mockOperation = mock(() => Promise.reject(new Error('Operation failed')))

    expect(withClient(123, mockGetClient, mockOperation)).rejects.toThrow()
  })
})
