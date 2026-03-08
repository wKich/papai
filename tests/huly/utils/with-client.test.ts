import { describe, expect, it, mock } from 'bun:test'

import { HulyApiError } from '../../../src/huly/classify-error.js'
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

  it('should close client even when operation throws', async () => {
    const mockClient = new MockHulyClient()
    const mockGetClient = mock(() => Promise.resolve(mockClient))
    const mockOperation = mock(() => Promise.reject(new Error('Operation failed')))

    try {
      await withClient(123, mockGetClient, mockOperation)
      throw new Error('Expected withClient to throw')
    } catch (error) {
      expect(error).toMatchObject({ message: 'Operation failed' })
    }

    expect(mockClient.close).toHaveBeenCalled()
  })

  it('should classify getClient errors and skip close when client is not acquired', async () => {
    const mockClient = new MockHulyClient()
    const mockGetClient = mock(() => Promise.reject(new Error('authentication failed')))
    const mockOperation = mock(() => Promise.resolve('result'))

    try {
      await withClient(123, mockGetClient, mockOperation)
      throw new Error('Expected withClient to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(HulyApiError)
      expect(error).toMatchObject({
        message: 'authentication failed',
        appError: { type: 'huly', code: 'auth-failed' },
      })
    }

    expect(mockOperation).not.toHaveBeenCalled()
    expect(mockClient.close).not.toHaveBeenCalled()
  })
})
