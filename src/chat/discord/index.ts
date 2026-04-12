import { logger } from '../../logger.js'
import { routeInteraction } from '../interaction-router.js'
import type {
  AuthorizationResult,
  ChatProvider,
  CommandHandler,
  IncomingInteraction,
  IncomingMessage,
  ReplyFn,
  ResolveUserContext,
  ThreadCapabilities,
} from '../types.js'
import { type ButtonInteractionLike, isButtonInteraction } from './buttons.js'
import {
  type DiscordClientFactory,
  type DiscordClientLike,
  type DispatchableMessage,
  type GuildLike,
  defaultClientFactory,
} from './client-factory.js'
import { chunkForDiscord } from './format-chunking.js'
import { buildDiscordInteraction } from './interaction-helpers.js'
import { mapDiscordMessage } from './map-message.js'
import { discordCapabilities, discordConfigRequirements, discordTraits } from './metadata.js'
import { buildDiscordReplyContext } from './reply-context.js'
import { createDiscordReplyFn } from './reply-helpers.js'
import { withTypingIndicator } from './typing-indicator.js'

export type { DiscordClientFactory, DiscordClientLike, DispatchableMessage }
export { defaultClientFactory }

const log = logger.child({ scope: 'chat:discord' })
const DISCORD_MAX_CONTENT_LEN = 2000

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
  readonly capabilities = discordCapabilities
  readonly traits = discordTraits
  readonly configRequirements = discordConfigRequirements
  private readonly token: string
  private readonly clientFactory: DiscordClientFactory
  private readonly commands = new Map<string, CommandHandler>()
  private messageHandler: OnMessageHandler | null = null
  private interactionHandler?: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>
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

  onInteraction(handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void {
    this.interactionHandler = handler
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
      this.dispatchMessage(rawMsg, client.user?.id ?? '', adminUserId).catch((error: unknown) => {
        log.error({ error: error instanceof Error ? error.message : String(error) }, 'messageCreate dispatch failed')
      })
    })

    client.on('interactionCreate', (rawInteraction) => {
      if (!isButtonInteraction(rawInteraction)) return
      this.dispatchButtonInteraction(rawInteraction, adminUserId).catch((error: unknown) => {
        log.error(
          { error: error instanceof Error ? error.message : String(error) },
          'interactionCreate dispatch failed',
        )
      })
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

  testSetClient(c: DiscordClientLike): void {
    this.client = c
  }

  async testDispatchMessage(message: DispatchableMessage, botId: string, adminUserId: string): Promise<void> {
    await this.dispatchMessage(message, botId, adminUserId)
  }

  async testDispatchButtonInteraction(
    interaction: ButtonInteractionLike,
    _botId: string,
    adminUserId: string,
  ): Promise<void> {
    await this.dispatchButtonInteraction(interaction, adminUserId)
  }

  private async tryDeferUpdate(interaction: ButtonInteractionLike): Promise<void> {
    try {
      await interaction.deferUpdate()
    } catch (error) {
      log.warn(
        { error: error instanceof Error ? error.message : String(error), customId: interaction.customId },
        'Failed to deferUpdate Discord button interaction',
      )
    }
  }

  private buildInteraction(
    interaction: ButtonInteractionLike,
    adminUserId: string,
  ): {
    incoming: IncomingInteraction
    channel: NonNullable<ButtonInteractionLike['channel']>
    reply: ReplyFn
  } | null {
    const channel = interaction.channel
    if (channel === null) return null

    const isAdmin = interaction.user.id === adminUserId
    const incomingInteraction = buildDiscordInteraction(
      {
        user: interaction.user,
        customId: interaction.customId,
        channelId: interaction.channelId,
        channel,
        message: interaction.message,
      },
      isAdmin,
    )

    if (incomingInteraction === null) return null

    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })
    return { incoming: incomingInteraction, channel, reply }
  }

  private async dispatchButtonInteraction(interaction: ButtonInteractionLike, adminUserId: string): Promise<void> {
    await this.tryDeferUpdate(interaction)

    const result = this.buildInteraction(interaction, adminUserId)
    if (result === null) {
      log.debug({ customId: interaction.customId }, 'Could not build incoming interaction, skipping')
      return
    }

    const { incoming, channel } = result

    if (this.interactionHandler === undefined) {
      const handled = await routeInteraction(incoming, result.reply)
      if (handled) return
      await this.routeButtonFallback(interaction, channel, incoming.contextId, incoming.contextType, adminUserId)
      return
    }
    await this.interactionHandler(incoming, result.reply)
  }

  private async routeButtonFallback(
    interaction: ButtonInteractionLike,
    channel: NonNullable<ButtonInteractionLike['channel']>,
    contextId: string,
    contextType: 'dm' | 'group',
    adminUserId: string,
  ): Promise<void> {
    const data = interaction.customId

    // Note: cfg: and wizard_ prefixes are handled by routeInteraction
    // This fallback is for other button types (if any)
    log.debug({ customId: data }, 'Unhandled button interaction in routeButtonFallback')

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

    // Route slash-prefixed commands to command handler
    const command = this.matchCommand(mapped.text)
    if (command !== null) {
      mapped.commandMatch = command.match
      const auth: AuthorizationResult = {
        allowed: true,
        isBotAdmin: mapped.user.isAdmin,
        isGroupAdmin: mapped.user.isAdmin,
        storageContextId: mapped.contextId,
      }
      await command.handler(mapped, reply, auth)
      return
    }

    // Route to message handler
    if (this.messageHandler !== null) {
      await this.messageHandler(mapped, reply)
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
