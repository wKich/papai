import { handleEditorCallback, parseCallbackData, serializeCallbackData } from '../config-editor/index.js'
import { dispatchGroupSelectorResult } from '../group-settings/dispatch.js'
import { handleGroupSettingsSelectorCallback } from '../group-settings/selector.js'
import { getActiveGroupSettingsTarget } from '../group-settings/state.js'
import { logger } from '../logger.js'
import { cancelWizard, getNextPrompt, processWizardMessage } from '../wizard/engine.js'
import { validateAndSaveWizardConfig } from '../wizard/save.js'
import { getWizardSession, hasActiveWizard, resetWizardSession } from '../wizard/state.js'
import type { AuthorizationResult, IncomingInteraction, ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:interaction-router' })

async function replyTextPreferReplace(reply: ReplyFn, content: string): Promise<void> {
  if ('replaceText' in reply && typeof reply.replaceText === 'function') {
    await reply.replaceText(content)
    return
  }

  await reply.text(content)
}

async function replyButtonsPreferReplace(
  reply: ReplyFn,
  content: string,
  buttons: Parameters<ReplyFn['buttons']>[1]['buttons'],
): Promise<void> {
  if ('replaceButtons' in reply && typeof reply.replaceButtons === 'function') {
    await reply.replaceButtons(content, { buttons })
    return
  }

  await reply.buttons(content, { buttons })
}

function getTargetContextId(parsedTargetContextId: string | undefined, interaction: IncomingInteraction): string {
  if (parsedTargetContextId !== undefined) {
    return parsedTargetContextId
  }
  return getSettingsTargetContextId(interaction)
}

function getEditorCallbackKey(
  key: ReturnType<typeof parseCallbackData>['key'],
): Parameters<typeof handleEditorCallback>[3] {
  if (key === null) {
    return undefined
  }
  return key
}

function getResponseText(response: string | undefined): string {
  if (response === undefined) {
    return ''
  }
  return response
}

async function replyConfigEditorResult(
  reply: ReplyFn,
  targetContextId: string,
  result: ReturnType<typeof handleEditorCallback>,
): Promise<void> {
  const response = getResponseText(result.response)
  if (result.buttons !== undefined && result.buttons.length > 0) {
    await replyButtonsPreferReplace(
      reply,
      response,
      result.buttons.map((btn) => ({
        text: btn.text,
        callbackData: serializeCallbackData(btn, targetContextId),
      })),
    )
    return
  }
  await replyTextPreferReplace(reply, response)
}

export type InteractionRouteDeps = {
  handleGroupSettingsInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>
  handleConfigInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>
  handleWizardInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>
}

function defaultHandleGroupSettingsInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<boolean> {
  const result = handleGroupSettingsSelectorCallback(interaction.user.id, interaction.callbackData)
  return dispatchGroupSelectorResult(result, reply, interaction.user.id)
}

function getSettingsTargetContextId(interaction: IncomingInteraction): string {
  if (interaction.contextType !== 'dm') {
    return interaction.storageContextId
  }
  const activeGroupTarget = getActiveGroupSettingsTarget(interaction.user.id)
  if (activeGroupTarget === undefined || activeGroupTarget === null) {
    return interaction.storageContextId
  }
  return activeGroupTarget
}

async function defaultHandleConfigInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<boolean> {
  const { callbackData, user } = interaction
  if (!callbackData.startsWith('cfg:')) return false

  const parsed = parseCallbackData(callbackData)

  if (parsed.action === null) {
    log.warn({ callbackData }, 'Unknown config editor callback data')
    await replyTextPreferReplace(reply, 'This action is no longer valid. Please start over with /config.')
    return true
  }

  const targetContextId = getTargetContextId(parsed.targetContextId, interaction)
  log.debug(
    { userId: user.id, contextId: targetContextId, action: parsed.action, key: parsed.key },
    'Handling config editor callback',
  )

  const key = getEditorCallbackKey(parsed.key)
  const result = handleEditorCallback(user.id, targetContextId, parsed.action, key)

  if (!result.handled) {
    log.warn({ action: parsed.action, key: parsed.key }, 'Config editor callback not handled')
    await replyTextPreferReplace(reply, 'This action is no longer valid. Please start over with /config.')
    return true
  }

  await replyConfigEditorResult(reply, targetContextId, result)

  return true
}

async function replyWithWizardButtons(
  reply: ReplyFn,
  response: string | undefined,
  buttons: Array<{ text: string; action: string }> | undefined,
  targetContextId: string | undefined,
): Promise<void> {
  const contextSuffix = targetContextId === undefined ? '' : `@${Buffer.from(targetContextId).toString('base64url')}`
  if (buttons !== undefined && buttons.length > 0) {
    const content = getResponseText(response)
    await replyButtonsPreferReplace(
      reply,
      content,
      buttons.map((button) => ({
        text: button.text,
        callbackData: `wizard_${button.action}${contextSuffix}`,
      })),
    )
    return
  }

  const content = getResponseText(response)
  await replyTextPreferReplace(reply, content)
}

async function handleWizardEdit(userId: string, storageContextId: string, reply: ReplyFn): Promise<boolean> {
  const session = getWizardSession(userId, storageContextId)
  if (session === null) {
    await replyTextPreferReplace(reply, 'No active setup session. Type /setup to start.')
    return true
  }

  resetWizardSession(userId, storageContextId)
  await reply.text(`🔧 Editing configuration from the beginning...\n\n${getNextPrompt(userId, storageContextId)}`)
  return true
}

function parseWizardContextId(callbackData: string): { action: string; targetContextId: string | undefined } {
  const atIdx = callbackData.indexOf('@')
  if (atIdx === -1) return { action: callbackData, targetContextId: undefined }
  try {
    const encoded = callbackData.slice(atIdx + 1)
    return { action: callbackData.slice(0, atIdx), targetContextId: Buffer.from(encoded, 'base64url').toString('utf8') }
  } catch {
    return { action: callbackData, targetContextId: undefined }
  }
}

async function handleWizardSkip(
  action: 'wizard_skip_small_model' | 'wizard_skip_embedding',
  userId: string,
  storageContextId: string,
  reply: ReplyFn,
): Promise<boolean> {
  const skipValue = action === 'wizard_skip_small_model' ? 'same' : 'skip'
  const result = await processWizardMessage(userId, storageContextId, skipValue)
  if (!result.handled) return true
  await replyWithWizardButtons(reply, result.response, result.buttons, storageContextId)
  return true
}

async function defaultHandleWizardInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<boolean> {
  const { callbackData, user } = interaction
  if (!callbackData.startsWith('wizard_')) return false

  const userId = user.id
  const { action, targetContextId: callbackContextId } = parseWizardContextId(callbackData)
  const storageContextId = getTargetContextId(callbackContextId, interaction)

  switch (action) {
    case 'wizard_confirm': {
      const result = await validateAndSaveWizardConfig(userId, storageContextId)
      await replyWithWizardButtons(reply, result.message, result.buttons, storageContextId)
      return true
    }
    case 'wizard_cancel': {
      if (!hasActiveWizard(userId, storageContextId)) {
        await replyTextPreferReplace(reply, 'No active setup session. Type /setup to start.')
        return true
      }
      cancelWizard(userId, storageContextId)
      await reply.text('❌ Wizard cancelled. Type /setup to restart.')
      return true
    }
    case 'wizard_restart': {
      if (!hasActiveWizard(userId, storageContextId)) {
        await replyTextPreferReplace(reply, 'No active setup session. Type /setup to start.')
        return true
      }
      cancelWizard(userId, storageContextId)
      await reply.text('Restarting wizard... Type /setup to begin.')
      return true
    }
    case 'wizard_edit':
      return handleWizardEdit(userId, storageContextId, reply)
    case 'wizard_skip_small_model':
    case 'wizard_skip_embedding':
      return handleWizardSkip(action, userId, storageContextId, reply)
    default:
      return false
  }
}

const defaultDeps: InteractionRouteDeps = {
  handleGroupSettingsInteraction: defaultHandleGroupSettingsInteraction,
  handleConfigInteraction: defaultHandleConfigInteraction,
  handleWizardInteraction: defaultHandleWizardInteraction,
}

export function routeInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
  auth: AuthorizationResult,
): Promise<boolean>
export function routeInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
  auth: AuthorizationResult,
  deps: InteractionRouteDeps,
): Promise<boolean>
export function routeInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
  auth: AuthorizationResult,
  ...rest: [] | [InteractionRouteDeps]
): Promise<boolean> {
  const deps = rest[0]
  let resolvedDeps = defaultDeps
  if (deps !== undefined) {
    resolvedDeps = deps
  }
  if (!auth.allowed) {
    return reply.text('You are not authorized to use this bot.').then(() => true)
  }

  const { callbackData } = interaction

  if (callbackData.startsWith('gsel:')) {
    return resolvedDeps.handleGroupSettingsInteraction(interaction, reply)
  }

  if (callbackData.startsWith('cfg:')) {
    return resolvedDeps.handleConfigInteraction(interaction, reply)
  }

  if (callbackData.startsWith('wizard_')) {
    return resolvedDeps.handleWizardInteraction(interaction, reply)
  }

  log.debug({ callbackData }, 'No route matched for interaction callback')
  return Promise.resolve(false)
}
