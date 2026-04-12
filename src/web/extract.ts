import { Defuddle } from 'defuddle/node'
import { parseHTML } from 'linkedom'

import { webFetchError } from '../errors.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'web:extract' })

class ExtractHtmlClassifiedError extends Error {
  readonly type = 'web-fetch' as const
  readonly code: ReturnType<typeof webFetchError.extractFailed>['code']

  constructor(
    message: string,
    public readonly appError: ReturnType<typeof webFetchError.extractFailed>,
  ) {
    super(message)
    this.name = 'ExtractHtmlClassifiedError'
    this.code = appError.code
  }
}

export interface ExtractHtmlDeps {
  parseDocument: typeof parseHTML
  defuddle: typeof Defuddle
}

const defaultDeps: ExtractHtmlDeps = {
  parseDocument: parseHTML,
  defuddle: Defuddle,
}

function throwExtractFailed(): never {
  throw new ExtractHtmlClassifiedError('Failed to extract readable content', webFetchError.extractFailed())
}

export async function extractHtmlContent(
  html: string,
  url: string,
  deps: ExtractHtmlDeps = defaultDeps,
): Promise<{ title: string; content: string }> {
  log.debug({ url, htmlLength: html.length }, 'extractHtmlContent')

  const { document } = deps.parseDocument(html)
  const result = await deps.defuddle(document, url, { markdown: true })

  const title = result.title?.trim() || document.title?.trim() || new URL(url).hostname
  const content = result.content?.trim() ?? ''

  if (content.length === 0) {
    log.warn({ url }, 'HTML extraction returned empty content')
    throwExtractFailed()
  }

  log.info({ url, title }, 'Extracted HTML content')
  return { title, content }
}
