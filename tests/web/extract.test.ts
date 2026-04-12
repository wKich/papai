import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { DefuddleResponse } from 'defuddle/node'
import { parseHTML } from 'linkedom'

import { getUserMessage, webFetchError } from '../../src/errors.js'
import { extractHtmlContent, type ExtractHtmlDeps } from '../../src/web/extract.js'
import { expectAppError, mockLogger } from '../utils/test-helpers.js'

function hasAppError(error: unknown): error is Error & { appError: unknown } {
  return error instanceof Error && 'appError' in error
}

function createDefuddleResponse(content: string, title = 'Sample Article'): DefuddleResponse {
  return {
    title,
    description: '',
    domain: 'example.com',
    favicon: '',
    image: '',
    language: 'en',
    parseTime: 0,
    published: '',
    author: '',
    site: 'Example',
    schemaOrgData: null,
    wordCount: 0,
    content,
  }
}

describe('extractHtmlContent', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('returns cleaned markdown content from Defuddle', async () => {
    const deps: ExtractHtmlDeps = {
      parseDocument: () => parseHTML('<html><head><title>ignored</title></head></html>'),
      defuddle: mock(
        (
          _input: Parameters<ExtractHtmlDeps['defuddle']>[0],
          _url?: Parameters<ExtractHtmlDeps['defuddle']>[1],
          _options?: Parameters<ExtractHtmlDeps['defuddle']>[2],
        ) => Promise.resolve(createDefuddleResponse('# Hello\n\nThis is clean markdown.')),
      ),
    }

    await expect(extractHtmlContent('<html></html>', 'https://example.com/post', deps)).resolves.toEqual({
      title: 'Sample Article',
      content: '# Hello\n\nThis is clean markdown.',
    })
  })

  test('rejects with extract-failed when Defuddle returns empty content', async () => {
    const deps: ExtractHtmlDeps = {
      parseDocument: () => parseHTML('<html><head><title>ignored</title></head></html>'),
      defuddle: mock(
        (
          _input: Parameters<ExtractHtmlDeps['defuddle']>[0],
          _url?: Parameters<ExtractHtmlDeps['defuddle']>[1],
          _options?: Parameters<ExtractHtmlDeps['defuddle']>[2],
        ) => Promise.resolve(createDefuddleResponse('   ')),
      ),
    }

    try {
      await extractHtmlContent('<html></html>', 'https://example.com/post', deps)
      throw new Error('Expected extractHtmlContent to reject')
    } catch (error) {
      expectAppError(error, getUserMessage(webFetchError.extractFailed()))
      if (!hasAppError(error)) {
        throw new Error('Expected error with appError', { cause: error })
      }
      expect(error).toMatchObject({
        type: 'web-fetch',
        code: 'extract-failed',
        appError: webFetchError.extractFailed(),
      })
    }
  })
})
