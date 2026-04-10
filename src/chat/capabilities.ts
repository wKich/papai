import type { ChatProvider } from './types.js'

/** Returns true if the chat platform supports interactive buttons with callbacks. */
export function supportsInteractiveButtons(chat: ChatProvider): boolean {
  return chat.capabilities.has('messages.buttons') && chat.capabilities.has('interactions.callbacks')
}

/** Returns true if the chat platform supports sending file attachments in replies. */
export function supportsFileReplies(chat: ChatProvider): boolean {
  return chat.capabilities.has('messages.files')
}

/** Returns true if the chat platform can resolve usernames to user IDs. */
export function supportsUserResolution(chat: ChatProvider): boolean {
  return chat.capabilities.has('users.resolve')
}

/** Returns true if the chat platform supports a native bot command menu. */
export function supportsCommandMenu(chat: ChatProvider): boolean {
  return chat.capabilities.has('commands.menu')
}
