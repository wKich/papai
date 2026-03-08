import type { getHulyClient } from './huly-client.js'

export type HulyClient = Awaited<ReturnType<typeof getHulyClient>>
