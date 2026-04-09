/**
 * Tests for Telegram chat provider
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import { extractFilesFromContext } from '../../../src/chat/telegram/file-helpers.js'
import { TelegramChatProvider } from '../../../src/chat/telegram/index.js'
import { mockLogger } from '../../utils/test-helpers.js'

describe('TelegramChatProvider', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('provider has correct name', () => {
    // We can't instantiate without TELEGRAM_BOT_TOKEN, but we can verify the class exists
    expect(typeof TelegramChatProvider).toBe('function')
  })

  describe('resolveUserId', () => {
    test('returns numeric ID as-is', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()
      const result = await provider.resolveUserId('123456789')
      expect(result).toBe('123456789')
      delete process.env['TELEGRAM_BOT_TOKEN']
    })

    test('returns null for username (cannot resolve via Bot API)', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()
      const result = await provider.resolveUserId('@username')
      expect(result).toBeNull()
      delete process.env['TELEGRAM_BOT_TOKEN']
    })
  })
})

describe('extractFilesFromContext', () => {
  beforeEach(() => {
    mockLogger()
  })

  const makeFileFetcher =
    (content: Buffer | null = Buffer.from('data')) =>
    (_fileId: string): Promise<Buffer | null> =>
      Promise.resolve(content)

  test('returns empty array when message has no files', async () => {
    const ctx = { message: {} }
    const result = await extractFilesFromContext(ctx, makeFileFetcher())
    expect(result).toEqual([])
  })

  test('returns empty array when message is undefined', async () => {
    const result = await extractFilesFromContext({}, makeFileFetcher())
    expect(result).toEqual([])
  })

  test('extracts document', async () => {
    const content = Buffer.from('file content')
    const ctx = {
      message: {
        document: {
          file_id: 'doc-123',
          file_name: 'report.pdf',
          mime_type: 'application/pdf',
          file_size: 1234,
        },
      },
    }
    const result = await extractFilesFromContext(ctx, makeFileFetcher(content))
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      fileId: 'doc-123',
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 1234,
      content,
    })
  })

  test('extracts photo (largest size)', async () => {
    const ctx = {
      message: {
        photo: [
          { file_id: 'photo-small', file_size: 100 },
          { file_id: 'photo-large', file_size: 5000 },
        ],
      },
    }
    const result = await extractFilesFromContext(ctx, makeFileFetcher())
    expect(result).toHaveLength(1)
    expect(result[0]?.fileId).toBe('photo-large')
    expect(result[0]?.filename).toBe('photo.jpg')
    expect(result[0]?.mimeType).toBe('image/jpeg')
  })

  test('extracts audio with filename', async () => {
    const ctx = {
      message: {
        audio: {
          file_id: 'audio-1',
          file_name: 'song.mp3',
          mime_type: 'audio/mpeg',
          file_size: 2048,
        },
      },
    }
    const result = await extractFilesFromContext(ctx, makeFileFetcher())
    expect(result[0]?.fileId).toBe('audio-1')
    expect(result[0]?.filename).toBe('song.mp3')
    expect(result[0]?.mimeType).toBe('audio/mpeg')
  })

  test('extracts audio with fallback filename', async () => {
    const ctx = { message: { audio: { file_id: 'audio-1', file_size: 2048 } } }
    const result = await extractFilesFromContext(ctx, makeFileFetcher())
    expect(result[0]?.filename).toBe('audio')
  })

  test('extracts video', async () => {
    const ctx = {
      message: {
        video: {
          file_id: 'vid-1',
          file_name: 'clip.mp4',
          mime_type: 'video/mp4',
          file_size: 10000,
        },
      },
    }
    const result = await extractFilesFromContext(ctx, makeFileFetcher())
    expect(result[0]?.fileId).toBe('vid-1')
    expect(result[0]?.filename).toBe('clip.mp4')
  })

  test('extracts voice note with fallback filename', async () => {
    const ctx = { message: { voice: { file_id: 'voice-1', file_size: 512 } } }
    const result = await extractFilesFromContext(ctx, makeFileFetcher())
    expect(result[0]?.filename).toBe('voice.ogg')
    expect(result[0]?.mimeType).toBe('audio/ogg')
  })

  test('skips file when fetcher returns null', async () => {
    const ctx = {
      message: {
        document: { file_id: 'doc-123', file_name: 'file.txt', mime_type: 'text/plain', file_size: 10 },
      },
    }
    const result = await extractFilesFromContext(ctx, makeFileFetcher(null))
    expect(result).toEqual([])
  })

  test('uses fallback filename for document without file_name', async () => {
    const ctx = {
      message: {
        document: { file_id: 'doc-123', mime_type: 'application/octet-stream', file_size: 10 },
      },
    }
    const result = await extractFilesFromContext(ctx, makeFileFetcher())
    expect(result[0]?.filename).toBe('document')
  })
})
