import { logger } from '../../logger.js'
import type {
  AuthorizationResult,
  ChatProvider,
  CommandHandler,
  ContextType,
  IncomingMessage,
  ReplyFn,
  ResolveUserContext,
} from '../types.js'
import {
  cacheIncomingPost,
  downloadMattermostFile,
  fetchMattermostFiles,
  parsePostedEvent,
  uploadMattermostFile,
} from './file-helpers.js'
import { mattermostCapabilities, mattermostConfigRequirements, mattermostTraits } from './metadata.js'
import { buildMattermostReplyContext } from './reply-context.js'
import { createMattermostReplyFn } from './reply-helpers.js'
import {
  ChannelInfoSchema,
  ChannelMemberSchema,
  ChannelSchema,
  extractReplyId,
  type MattermostPost,
  MattermostWsEventSchema,
  UserMeSchema,
} from './schema.js'

export { extractReplyId, MattermostPostSchema } from './schema.js'

const log = logger.child({ scope: 'chat:mattermost' })

export class MattermostChatProvider implements ChatProvider {
  readonly name = 'mattermost'
  readonly threadCapabilities = {
    supportsThreads: true,
    canCreateThreads: false,
    threadScope: 'post' as const,
  }
  readonly capabilities = mattermostCapabilities
  readonly traits = mattermostTraits
  readonly configRequirements = mattermostConfigRequirements
  private readonly baseUrl: string
  private readonly token: string
  private readonly commands = new Map<string, CommandHandler>()
  private messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null = null
  private ws: WebSocket | null = null
  private botUserId: string | null = null
  private botUsername: string | null = null
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
    const user = UserMeSchema.parse(data)
    this.botUserId = user.id
    this.botUsername = user.username ?? null
    log.info({ botUserId: this.botUserId, botUsername: this.botUsername }, 'Mattermost bot started')
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
      log.debug('Mattermost WebSocket connected, authenticating')
      this.wsSend({ seq: this.wsSeq++, action: 'authentication_challenge', data: { token: this.token } })
    })
    ws.addEventListener('message', (event) => {
      void this.handleWsMessage(event)
    })
    ws.addEventListener('close', () => {
      log.warn('Mattermost WebSocket closed, reconnecting in 5s')
      setTimeout(() => {
        this.connectWebSocket()
      }, 5000)
    })
    ws.addEventListener('error', (event) => {
      log.error({ event }, 'Mattermost WebSocket error')
    })
  }

  private async handleWsMessage(event: MessageEvent): Promise<void> {
    const parsed = MattermostWsEventSchema.safeParse(JSON.parse(String(event.data)))
    if (!parsed.success) return
    if (parsed.data.event === 'hello') {
      log.info('Mattermost WebSocket authenticated')
      return
    }
    if (parsed.data.event === 'posted') {
      await this.handlePostedEvent(parsed.data.data)
    }
  }

  private async handlePostedEvent(data: Record<string, unknown>): Promise<void> {
    const parsed = parsePostedEvent(data)
    if (parsed === null) return

    const { post, senderName } = parsed
    if (post.user_id === this.botUserId) return

    const replyToMessageId = extractReplyId(post.parent_id, post.root_id)
    cacheIncomingPost(post, replyToMessageId, senderName)
    const { msg, reply, command, isAdmin } = await this.buildPostedMessage(post, senderName, replyToMessageId)
    await this.dispatchMsg(msg, reply, command, isAdmin)
  }

  private async buildPostedMessage(
    post: MattermostPost,
    senderName: string | undefined,
    replyToMessageId: string | undefined,
  ): Promise<{
    msg: IncomingMessage
    reply: ReplyFn
    command: { handler: CommandHandler; match: string } | null
    isAdmin: boolean
  }> {
    const replyContext =
      replyToMessageId === undefined
        ? undefined
        : await buildMattermostReplyContext(post, replyToMessageId, this.apiFetch.bind(this))
    const channelInfo = await this.fetchChannelInfo(post.channel_id)
    const contextType: ContextType = channelInfo.type === 'D' ? 'dm' : 'group'
    const isAdmin = await this.checkChannelAdmin(post.channel_id, post.user_id)
    const threadId = post.root_id === undefined || post.root_id === '' ? replyToMessageId : post.root_id
    const reply = this.buildReplyFn(post.channel_id, post.id, threadId)
    const command = this.matchCommand(post.message)
    const username = post.user_name ?? senderName ?? null

    const files =
      post.file_ids !== undefined && post.file_ids.length > 0
        ? await fetchMattermostFiles(post.file_ids, this.apiFetch.bind(this), (fileId) =>
            downloadMattermostFile(this.baseUrl, this.token, fileId),
          )
        : undefined

    const msg: IncomingMessage = {
      user: { id: post.user_id, username, isAdmin },
      contextId: post.channel_id,
      contextType,
      isMentioned: this.isBotMentioned(post.message),
      text: post.message,
      commandMatch: command?.match,
      messageId: post.id,
      replyToMessageId,
      replyContext,
      ...(files !== undefined && files.length > 0 ? { files } : {}),
    }
    return { msg, reply, command, isAdmin }
  }

  private async dispatchMsg(
    msg: IncomingMessage,
    reply: ReplyFn,
    command: { handler: CommandHandler; match: string } | null,
    isAdmin: boolean,
  ): Promise<void> {
    if (command !== null) {
      const auth: AuthorizationResult = {
        allowed: true,
        isBotAdmin: isAdmin,
        isGroupAdmin: isAdmin,
        storageContextId: msg.contextId,
      }
      await command.handler(msg, reply, auth)
      return
    }
    if (this.messageHandler !== null) {
      await this.messageHandler(msg, reply)
    }
  }

  private isBotMentioned(message: string): boolean {
    if (this.botUsername === null) return false
    return message.includes(`@${this.botUsername}`)
  }

  private async fetchChannelInfo(channelId: string): Promise<{ type: string }> {
    const data = await this.apiFetch('GET', `/api/v4/channels/${channelId}`, undefined)
    const parsed = ChannelInfoSchema.safeParse(data)
    if (!parsed.success) {
      log.warn({ channelId, error: parsed.error }, 'Failed to parse channel info')
      return { type: '' }
    }
    return parsed.data
  }

  private async checkChannelAdmin(channelId: string, userId: string): Promise<boolean> {
    try {
      const data = await this.apiFetch('GET', `/api/v4/channels/${channelId}/members/${userId}`, undefined)
      const parsed = ChannelMemberSchema.safeParse(data)
      if (!parsed.success) {
        log.warn({ channelId, userId, error: parsed.error }, 'Failed to parse channel member')
        return false
      }
      return parsed.data.roles.includes('channel_admin')
    } catch {
      return false
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

  private buildReplyFn(channelId: string, postId?: string, threadId?: string): ReplyFn {
    return createMattermostReplyFn({
      channelId,
      postId,
      threadId,
      baseUrl: this.baseUrl,
      getWsSeq: () => this.wsSeq++,
      apiFetch: this.apiFetch.bind(this),
      wsSend: this.wsSend.bind(this),
      uploadFile: (uploadChannelId, content, filename) =>
        uploadMattermostFile(this.baseUrl, this.token, uploadChannelId, content, filename),
    })
  }

  private async getOrCreateDmChannel(userId: string): Promise<string> {
    if (this.botUserId === null) throw new Error('Bot not started')
    const data = await this.apiFetch('POST', '/api/v4/channels/direct', [this.botUserId, userId])
    return ChannelSchema.parse(data).id
  }

  async resolveUserId(username: string, _context: ResolveUserContext): Promise<string | null> {
    const cleanUsername = username.startsWith('@') ? username.slice(1) : username
    try {
      const data = await this.apiFetch('GET', `/api/v4/users/username/${encodeURIComponent(cleanUsername)}`, undefined)
      const parsed = UserMeSchema.safeParse(data)
      if (parsed.success) {
        return parsed.data.id
      }
      return null
    } catch {
      return null
    }
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
