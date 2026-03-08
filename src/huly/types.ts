import type { getHulyClient } from './huly-client.js'

export type HulyClient = Awaited<ReturnType<typeof getHulyClient>>

export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low'
