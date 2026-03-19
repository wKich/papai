import { z } from 'zod'

import { logger } from '../../logger.js'
import type { ChatProvider, CommandHandler, IncomingMessage, ReplyFn } from '../types.js'

const log = logger.child({ scope: 'chat:mattermost' })

const MattermostWsEventSchema = z.object({
  event: z.string(),
  data: z.record(z.string(), z.unknown()),
})

const MattermostPostSchema = z.object({
  user_id: z.string(),
  channel_id: z.string(),
  message: z.string(),
})

const UserMeSchema = z.object({ id: z.string() })
const ChannelSchema = z.object({ id: z.string() })
const FileUploadSchema = z.object({ file_infos: z.array(z.object({ id: z.string() })) })

type MattermostWsEvent = z.infer<typeof MattermostWsEventSchema>

export class MattermostChatProvider implements ChatProvider {
  readonly name = 'mattermost'
  private readonly baseUrl: string
  private readonly token: string
  private readonly commands = new Map<string, CommandHandler>()
  private messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null = null
  private ws: WebSocket | null = null
  private botUserId: string | null = null
  private wsSeq = 1

  constructor() {
    const url = process.env['MATTERMOST_URL']
    const token = process.env['MATTERMOST_BOT_TOKEN']
    if (url === undefined || url.trim() === '') {
      throw new Error('MATTERMOST_URL environment variable is required')
    }
    if (token === undefined || token.trim() === '') {
      throw new Error('MATTERMOST_BOT_TOKEN environment variable is required')
    }
    this.baseUrl = url.replace(/\/+$/, '')
    this.token = token
  }

  registerCommand(name: string, handler: CommandHandler): void {
    this.commands.set(name, handler)
  }

  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
    this.messageHandler = handler
  }

  async sendMessage(userId: string, markdown: string): Promise<void> {
    const channelId = await this.getOrCreateDmChannel(userId)
    await this.apiFetch('POST', '/api/v4/posts', { channel_id: channelId, message: markdown })
  }

  async start(): Promise<void> {
    const data = await this.apiFetch('GET', '/api/v4/users/me', undefined)
    this.botUserId = UserMeSchema.parse(data).id
    log.info({ botUserId: this.botUserId }, 'Mattermost bot started')
    this.connectWebSocket()
  }

  stop(): Promise<void> {
    this.ws?.close()
    this.ws = null
    log.info('Mattermost bot stopped')
    return Promise.resolve()
  }

  private connectWebSocket(): void {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/api/v4/websocket'
    log.debug({ wsUrl }, 'Connecting to Mattermost WebSocket')
    const ws = new WebSocket(wsUrl)
    this.ws = ws
    ws.addEventListener('open', () => {
      this.onWsOpen()
    })
    ws.addEventListener('message', (event) => {
      void this.onWsMessage(event)
    })
    ws.addEventListener('close', () => {
      this.onWsClose()
    })
    ws.addEventListener('error', (event) => {
      log.error({ event }, 'Mattermost WebSocket error')
    })
  }

  private onWsOpen(): void {
    log.debug('Mattermost WebSocket connected, authenticating')
    this.wsSend({ seq: this.wsSeq++, action: 'authentication_challenge', data: { token: this.token } })
  }

  private onWsClose(): void {
    log.warn('Mattermost WebSocket closed, reconnecting in 5s')
    setTimeout(() => {
      this.connectWebSocket()
    }, 5000)
  }

  private async onWsMessage(event: MessageEvent): Promise<void> {
    const parsed = MattermostWsEventSchema.safeParse(JSON.parse(String(event.data)))
    if (!parsed.success) return
    const wsEvent: MattermostWsEvent = parsed.data
    if (wsEvent.event === 'hello') {
      log.info('Mattermost WebSocket authenticated')
      return
    }
    if (wsEvent.event === 'posted') {
      await this.handlePostedEvent(wsEvent.data)
    }
  }

  private async handlePostedEvent(data: Record<string, unknown>): Promise<void> {
    const postJson = data['post']
    if (typeof postJson !== 'string') return
    const postResult = MattermostPostSchema.safeParse(JSON.parse(postJson))
    if (!postResult.success) return
    const post = postResult.data
    if (post.user_id === this.botUserId) return
    const reply = this.buildReplyFn(post.channel_id)
    const command = this.matchCommand(post.message)
    if (command !== null) {
      const msg: IncomingMessage = {
        user: { id: post.user_id, username: null },
        text: post.message,
        commandMatch: command.match,
      }
      await command.handler(msg, reply)
      return
    }
    if (this.messageHandler !== null) {
      const msg: IncomingMessage = { user: { id: post.user_id, username: null }, text: post.message }
      await this.messageHandler(msg, reply)
    }
  }

  private matchCommand(text: string): { handler: CommandHandler; match: string } | null {
    const trimmed = text.trim()
    if (!trimmed.startsWith('/')) return null
    for (const [name, handler] of this.commands) {
      if (trimmed === `/${name}` || trimmed.startsWith(`/${name} `)) {
        const match = trimmed.slice(name.length + 1).trim()
        return { handler, match }
      }
    }
    return null
  }

  private buildReplyFn(channelId: string): ReplyFn {
    return {
      text: async (content: string) => {
        await this.apiFetch('POST', '/api/v4/posts', { channel_id: channelId, message: content })
      },
      formatted: async (markdown: string) => {
        await this.apiFetch('POST', '/api/v4/posts', { channel_id: channelId, message: markdown })
      },
      file: async (file) => {
        const fileId = await this.uploadFile(channelId, file.content, file.filename)
        await this.apiFetch('POST', '/api/v4/posts', { channel_id: channelId, message: '', file_ids: [fileId] })
      },
      typing: () => {
        this.wsSend({ seq: this.wsSeq++, action: 'user_typing', data: { channel_id: channelId } })
      },
    }
  }

  private async uploadFile(channelId: string, content: Buffer | string, filename: string): Promise<string> {
    const body = new FormData()
    const blob = new Blob([content])
    body.append('files', blob, filename)
    const url = `${this.baseUrl}/api/v4/files?channel_id=${encodeURIComponent(channelId)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body,
    })
    if (!res.ok) throw new Error(`Mattermost file upload failed: ${res.status}`)
    const data: unknown = await res.json()
    const result = FileUploadSchema.safeParse(data)
    if (!result.success) throw new Error('Invalid file upload response from Mattermost')
    const fileId = result.data.file_infos[0]?.id
    if (fileId === undefined) throw new Error('Mattermost file upload returned no file ID')
    return fileId
  }

  private async getOrCreateDmChannel(userId: string): Promise<string> {
    if (this.botUserId === null) throw new Error('Bot not started')
    const data = await this.apiFetch('POST', '/api/v4/channels/direct', [this.botUserId, userId])
    return ChannelSchema.parse(data).id
  }

  private wsSend(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  private async apiFetch(method: string, path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Mattermost API ${method} ${path} failed: ${res.status}`)
    const data: unknown = await res.json()
    return data
  }
}
