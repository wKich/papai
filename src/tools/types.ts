export type ToolMode = 'normal' | 'proactive'

/**
 * Options for makeTools function.
 * Use this options object pattern for clarity - the single storageContextId
 * parameter replaces the confusing userId/contextId split.
 */
export type MakeToolsOptions = {
  /**
   * The storage context ID for the user/conversation.
   * This single identifier is used for:
   * - User-scoped tools (memos, recurring tasks, instructions)
   * - Group history lookup (if the ID contains a group/thread suffix)
   * - Attachment tools
   */
  storageContextId?: string
  /**
   * The actual chat user ID (different from storageContextId in group chats).
   * Used for identity tools to ensure per-user isolation.
   * In DMs, this is the same as storageContextId.
   * In groups, this is the actual user ID while storageContextId is the group ID.
   */
  chatUserId?: string
  /**
   * Tool mode: 'normal' (default) includes deferred prompt tools,
   * 'proactive' excludes them for proactive delivery contexts.
   */
  mode?: ToolMode
}
