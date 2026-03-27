import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible'
import { embed } from 'ai'

import { logger } from './logger.js'

const log = logger.child({ scope: 'embeddings' })

let cachedProvider: { key: string; provider: OpenAICompatibleProvider } | null = null

function getProvider(apiKey: string, baseUrl: string): OpenAICompatibleProvider {
  const key = `${apiKey}:${baseUrl}`
  if (cachedProvider !== null && cachedProvider.key === key) return cachedProvider.provider
  const provider = createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL: baseUrl })
  cachedProvider = { key, provider }
  return provider
}

export async function getEmbedding(text: string, apiKey: string, baseUrl: string, model: string): Promise<number[]> {
  log.debug({ textLength: text.length, model }, 'getEmbedding called')
  const provider = getProvider(apiKey, baseUrl)
  const { embedding } = await embed({
    model: provider.embeddingModel(model),
    value: text,
  })
  log.info({ model, dimension: embedding.length }, 'Embedding generated')
  return embedding
}

export async function tryGetEmbedding(
  text: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<number[] | null> {
  try {
    return await getEmbedding(text, apiKey, baseUrl, model)
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error), model }, 'Embedding generation failed')
    return null
  }
}
