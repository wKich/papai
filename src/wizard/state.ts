/**
 * Wizard state management
 * In-memory store for active wizard sessions
 */

import { logger } from '../logger.js'
import type { WizardSession, WizardData } from './types.js'

/**
 * Parameters required to create a new wizard session
 */
export interface CreateWizardSessionParams {
  readonly userId: string
  readonly storageContextId: string
  readonly totalSteps: number
  readonly platform: 'telegram' | 'mattermost'
  readonly taskProvider: 'kaneo' | 'youtrack'
  readonly initialData?: WizardData
}

/**
 * Update object for wizard session
 */
export interface WizardSessionUpdate {
  readonly currentStep?: number
  readonly data?: Partial<WizardData>
  readonly skippedSteps?: number[]
}

// In-memory Map for active sessions
const activeSessions: Map<string, WizardSession> = new Map()

/**
 * Create a session key from userId and storageContextId
 */
const createSessionKey = (userId: string, storageContextId: string): string => `${userId}:${storageContextId}`

/**
 * Create and store a new wizard session
 * Returns existing session if one already exists for this user/context
 */
export const createWizardSession = (params: CreateWizardSessionParams): WizardSession => {
  const { userId, storageContextId, totalSteps, platform, taskProvider, initialData } = params
  const key = createSessionKey(userId, storageContextId)

  const existingSession = activeSessions.get(key)
  if (existingSession !== undefined) {
    logger.warn({ userId, storageContextId }, 'Wizard session already exists, returning existing')
    return existingSession
  }

  const session: WizardSession = {
    userId,
    storageContextId,
    startedAt: new Date(),
    currentStep: 0,
    totalSteps,
    data: initialData ?? {},
    skippedSteps: [],
    platform,
    taskProvider,
  }

  activeSessions.set(key, session)

  logger.info(
    { userId, storageContextId, totalSteps, platform, taskProvider, hasInitialData: initialData !== undefined },
    'Wizard session created',
  )

  return session
}

/**
 * Retrieve a wizard session by userId and storageContextId
 * Returns null if no session exists
 */
export const getWizardSession = (userId: string, storageContextId: string): WizardSession | null => {
  const key = createSessionKey(userId, storageContextId)
  const session = activeSessions.get(key)

  logger.debug({ userId, storageContextId, hasSession: session !== undefined }, 'Getting wizard session')

  return session ?? null
}

/**
 * Check if a wizard session is active for the given user/context
 */
export const hasActiveWizard = (userId: string, storageContextId: string): boolean => {
  const key = createSessionKey(userId, storageContextId)
  const hasSession = activeSessions.has(key)

  logger.debug({ userId, storageContextId, hasSession }, 'Checking active wizard')

  return hasSession
}

/**
 * Update a wizard session with new data
 * Throws error if session doesn't exist
 */
export const updateWizardSession = (userId: string, storageContextId: string, update: WizardSessionUpdate): void => {
  const key = createSessionKey(userId, storageContextId)
  const session = activeSessions.get(key)

  if (session === undefined) {
    logger.error({ userId, storageContextId }, 'Attempted to update non-existent wizard session')
    throw new Error('Session not found')
  }

  const { currentStep, data, skippedSteps } = update

  if (currentStep !== undefined) {
    session.currentStep = currentStep
  }

  if (data !== undefined) {
    session.data = { ...session.data, ...data }
  }

  if (skippedSteps !== undefined) {
    session.skippedSteps = [...session.skippedSteps, ...skippedSteps]
  }

  logger.info(
    { userId, storageContextId, currentStep, hasData: data !== undefined, hasSkipped: skippedSteps !== undefined },
    'Wizard session updated',
  )
}

/**
 * Delete a wizard session
 * Returns true if a session was deleted, false otherwise
 */
export const deleteWizardSession = (userId: string, storageContextId: string): boolean => {
  const key = createSessionKey(userId, storageContextId)
  const existed = activeSessions.has(key)

  if (existed) {
    activeSessions.delete(key)
    logger.info({ userId, storageContextId }, 'Wizard session deleted')
  } else {
    logger.warn({ userId, storageContextId }, 'Attempted to delete non-existent wizard session')
  }

  return existed
}

// 30 minutes
const WIZARD_SESSION_TTL_MS = 30 * 60 * 1000

/**
 * Clean up expired wizard sessions
 * Removes sessions older than WIZARD_SESSION_TTL_MS
 */
export type WizardSnapshot = {
  userId: string
  storageContextId: string
  startedAt: string
  currentStep: number
  totalSteps: number
  platform: 'telegram' | 'mattermost'
  taskProvider: 'kaneo' | 'youtrack'
  skippedSteps: number[]
  dataKeys: string[]
}

export function getWizardSnapshots(userId: string): WizardSnapshot[] {
  const snapshots: WizardSnapshot[] = []
  for (const session of activeSessions.values()) {
    if (session.userId !== userId) continue
    snapshots.push({
      userId: session.userId,
      storageContextId: session.storageContextId,
      startedAt: session.startedAt.toISOString(),
      currentStep: session.currentStep,
      totalSteps: session.totalSteps,
      platform: session.platform,
      taskProvider: session.taskProvider,
      skippedSteps: [...session.skippedSteps],
      dataKeys: Object.keys(session.data),
    })
  }
  return snapshots
}

export function cleanupExpiredWizardSessions(): void {
  const now = Date.now()
  const expired: string[] = []

  for (const [key, session] of activeSessions) {
    if (now - session.startedAt.getTime() > WIZARD_SESSION_TTL_MS) {
      expired.push(key)
    }
  }

  for (const key of expired) {
    activeSessions.delete(key)
    logger.debug({ sessionKey: key }, 'Expired wizard session removed')
  }

  if (expired.length > 0) {
    logger.info({ expiredCount: expired.length }, 'Cleaned up expired wizard sessions')
  }
}
