import { type ModelMessage, modelMessageSchema } from 'ai'
import { z } from 'zod'

const modelMessageArraySchema = z.array(modelMessageSchema)

export const parseHistoryFromDb = (messagesJson: string): ModelMessage[] | null => {
  try {
    const result = modelMessageArraySchema.safeParse(JSON.parse(messagesJson))
    return result.success ? result.data : null
  } catch {
    return null
  }
}
