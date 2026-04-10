import { logger } from '../../logger.js'
import type {
  AuthorizationResult,
  ChatProvider,
  CommandHandler,
  IncomingMessage,
  ReplyFn,
  ResolveUserContext,
  ThreadCapabilities,
} from '../types.js'
import { type ButtonInteractionLike, dispatchButtonInteraction, isButtonInteraction } from './buttons.js'
import {
  type DiscordClientFactory,
  type DiscordClientLike,
  type DispatchableMessage,
  type GuildLike,
  defaultClientFactory,
} from './client-factory.js'
import { chunkForDiscord } from './format-chunking.js'
import { handleConfigEditorCallback, handleWizardCallback } from './handlers.js'
import { mapDiscordMessage } from './map-message.js'
import { buildDiscordReplyContext } from './reply-context.js'
import { createDiscordReplyFn } from './reply-helpers.js'
import { withTypingIndicator } from './typing-indicator.js'

export type { DiscordClientFactory, DiscordClientLike, DispatchableMessage }
export { defaultClientFactory }

const log = logger.child({ scope: 'chat:discord' })
const DISCORD_MAX_CONTENT_LEN = 2000
const CHANNEL_TYPE_DM = 1

type OnMessageHandler = (msg: IncomingMessage, reply: ReplyFn) => Promise<void>

type ReadyPayload = { user: { id: string; username: string } }

function isDispatchableMessage(v: unknown): v is DispatchableMessage {
  return typeof v === 'object' && v !== null && 'id' in v && 'author' in v && 'channel' in v
}

function isGuildLike(v: unknown): v is GuildLike {
  if (typeof v !== 'object' || v === null || !('members' in v)) return false
  const m = v.members
  return typeof m === 'object' && m !== null && 'search' in m && typeof m.search === 'function'
}

function isReadyPayload(v: unknown): v is ReadyPayload {
  if (typeof v !== 'object' || v === null || !('user' in v)) return false
  const u = v.user
  return typeof u === 'object' && u !== null && 'id' in u && 'username' in u
}

export class DiscordChatProvider implements ChatProvider {
  readonly name = 'discord'
  readonly threadCapabilities: ThreadCapabilities = {
    supportsThreads: false,
    canCreateThreads: false,
    threadScope: 'message',
  }
  private readonly token: string
  private readonly clientFactory: DiscordClientFactory
  private readonly commands = new Map<string, CommandHandler>()
  private messageHandler: OnMessageHandler | null = null
  private client: DiscordClientLike | null = null

  constructor(clientFactory?: DiscordClientFactory) {
    const token = process.env['DISCORD_BOT_TOKEN']
    if (token === undefined || token.trim() === '') {
      throw new Error('DISCORD_BOT_TOKEN environment variable is required')
    }
    this.token = token
    this.clientFactory = clientFactory ?? defaultClientFactory
    log.debug({ tokenLength: this.token.length }, 'DiscordChatProvider constructed')
  }

  registerCommand(name: string, handler: CommandHandler): void {
    this.commands.set(name, handler)
    log.debug({ command: name }, 'Discord command registered')
  }

  onMessage(handler: OnMessageHandler): void {
    this.messageHandler = handler
  }

  async sendMessage(userId: string, markdown: string): Promise<void> {
    if (this.client === null || this.client.users === undefined) {
      throw new Error('DiscordChatProvider.sendMessage called before start()')
    }
    const user = await this.client.users.fetch(userId)
    const dm = await user.createDM()
    const chunks = chunkForDiscord(markdown, DISCORD_MAX_CONTENT_LEN)
    await chunks.reduce<Promise<unknown>>(
      (prev, chunk) => prev.then(() => dm.send({ content: chunk })),
      Promise.resolve(null),
    )
    log.info({ userId }, 'Discord DM sent')
  }

  async resolveUserId(username: string, context: ResolveUserContext): Promise<string | null> {
    const clean = username.startsWith('@') ? username.slice(1) : username
    if (/^\d+$/.test(clean)) return clean
    if (context.contextType !== 'group') return null
    if (this.client === null) return null

    if (this.client.channels === undefined || this.client.guilds === undefined) return null
    const raw = this.client.channels.cache.get(context.contextId)
    if (typeof raw !== 'object' || raw === null || !('guildId' in raw)) return null
    const guildId = raw.guildId
    if (typeof guildId !== 'string') return null
    const rawGuild = this.client.guilds.cache.get(guildId)
    if (!isGuildLike(rawGuild)) return null

    try {
      const members = await rawGuild.members.search({ query: clean, limit: 1 })
      for (const m of members.values()) {
        return m.id
      }
      return null
    } catch (error) {
      log.warn(
        { username: clean, guildId, error: error instanceof Error ? error.message : String(error) },
        'Discord member search failed',
      )
      return null
    }
  }

  start(): Promise<void> {
    const adminUserId = process.env['ADMIN_USER_ID'] ?? ''
    const client = this.clientFactory()
    this.client = client

    client.on('messageCreate', (rawMsg) => {
      if (!isDispatchableMessage(rawMsg)) return
      void this.dispatchMessage(rawMsg, client.user?.id ?? '', adminUserId)
    })

    client.on('interactionCreate', (rawInteraction) => {
      if (!isButtonInteraction(rawInteraction)) return
      void this.handleButtonInteraction(rawInteraction, adminUserId)
    })

    client.on('error', (rawError) => {
      const msg = rawError instanceof Error ? rawError.message : String(rawError)
      log.error({ error: msg }, 'Discord client error')
    })

    return new Promise<void>((resolve, reject) => {
      client.once('ready', (readyClient) => {
        if (!isReadyPayload(readyClient)) return
        log.info({ botId: readyClient.user.id, botUsername: readyClient.user.username }, 'Discord bot is ready')
        resolve()
      })
      client.login(this.token).catch(reject)
    })
  }

  async stop(): Promise<void> {
    if (this.client === null) return
    await this.client.destroy()
    this.client = null
  }

  /** Test-only: inject a stub client. */
  testSetClient(c: DiscordClientLike): void {
    this.client = c
  }

  /** Test-only: simulate inbound messageCreate without a live Client. */
  async testDispatchMessage(message: DispatchableMessage, botId: string, adminUserId: string): Promise<void> {
    await this.dispatchMessage(message, botId, adminUserId)
  }

  /** Test-only: simulate a button interaction without a live Client. */
  async testDispatchButtonInteraction(
    interaction: ButtonInteractionLike,
    _botId: string,
    adminUserId: string,
  ): Promise<void> {
    await this.handleButtonInteraction(interaction, adminUserId)
  }

  private async handleButtonInteraction(interaction: ButtonInteractionLike, adminUserId: string): Promise<void> {
    const channel = interaction.channel
    if (channel === null) {
      log.warn({ channelId: interaction.channelId }, 'Button interaction: channel not available, skipping')
      return
    }

    const contextType = channel.type === CHANNEL_TYPE_DM ? ('dm' as const) : ('group' as const)
    const contextId = contextType === 'dm' ? interaction.user.id : interaction.channelId
    const userId = interaction.user.id

    const onCfg = async (data: string): Promise<void> => {
      await handleConfigEditorCallback(userId, contextId, data, channel)
    }
    const onWizard = async (data: string): Promise<void> => {
      await handleWizardCallback(userId, contextId, data, channel)
    }

    await dispatchButtonInteraction(interaction, onCfg, onWizard)

    this.routeButtonFallback(interaction, channel, contextId, contextType, adminUserId)
  }

  private routeButtonFallback(
    interaction: ButtonInteractionLike,
    channel: NonNullable<ButtonInteractionLike['channel']>,
    contextId: string,
    contextType: 'dm' | 'group',
    adminUserId: string,
  ): void {
    const data = interaction.customId
    if (data.startsWith('cfg:') || data.startsWith('wizard_')) return

    const mapped: IncomingMessage = {
      user: {
        id: interaction.user.id,
        username: interaction.user.username.length > 0 ? interaction.user.username : null,
        isAdmin: interaction.user.id === adminUserId,
      },
      contextId,
      contextType,
      isMentioned: true,
      text: data,
      messageId: interaction.message.id,
    }

    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })

    const command = this.matchCommand(mapped.text)
    if (command !== null) {
      mapped.commandMatch = command.match
      const auth: AuthorizationResult = {
        allowed: true,
        isBotAdmin: mapped.user.isAdmin,
        isGroupAdmin: mapped.user.isAdmin,
        storageContextId: mapped.contextId,
      }
      void command.handler(mapped, reply, auth)
      return
    }

    if (this.messageHandler !== null) {
      void this.messageHandler(mapped, reply)
    }
  }

  private async dispatchMessage(message: DispatchableMessage, botId: string, adminUserId: string): Promise<void> {
    const mapped = mapDiscordMessage(message, botId, adminUserId)
    if (mapped === null) return

    const reply = createDiscordReplyFn({
      channel: message.channel,
      replyToMessageId: mapped.messageId,
    })

    const command = this.matchCommand(mapped.text)
    if (command !== null) {
      mapped.commandMatch = command.match
      await command.handler(mapped, reply, {
        allowed: true,
        isBotAdmin: mapped.user.isAdmin,
        isGroupAdmin: mapped.user.isAdmin,
        storageContextId: mapped.contextId,
      })
      return
    }

    if (this.messageHandler !== null) {
      if (message.channel.messages !== undefined) {
        mapped.replyContext = await buildDiscordReplyContext(
          { reference: message.reference, channel: { id: message.channel.id, messages: message.channel.messages } },
          mapped.contextId,
        )
      }
      await withTypingIndicator(message.channel, () => this.messageHandler!(mapped, reply))
    }
  }

  private matchCommand(text: string): { handler: CommandHandler; match: string } | null {
    const trimmed = text.trim()
    if (!trimmed.startsWith('/')) return null
    for (const [name, handler] of this.commands) {
      if (trimmed === `/${name}` || trimmed.startsWith(`/${name} `)) {
        const match = trimmed.slice(name.length + 2).trim()
        return { handler, match }
      }
    }
    return null
  }
}
