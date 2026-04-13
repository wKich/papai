import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { groupAdminObservations, knownGroupContexts } from '../db/schema.js'
import { logger } from '../logger.js'
import type { GroupAdminObservation, KnownGroupContext } from './types.js'

const log = logger.child({ scope: 'group-settings:registry' })

const THROTTLE_MS = 5 * 60 * 1000

function isWithinThrottleWindow(lastSeenAtIso: string): boolean {
  return Date.now() - new Date(lastSeenAtIso).getTime() < THROTTLE_MS
}

type KnownGroupContextRow = typeof knownGroupContexts.$inferSelect
type GroupAdminObservationRow = typeof groupAdminObservations.$inferSelect

export interface UpsertKnownGroupContextInput {
  readonly contextId: string
  readonly provider: string
  readonly displayName: string
  readonly parentName: string | null
}

export interface UpsertGroupAdminObservationInput {
  readonly contextId: string
  readonly userId: string
  readonly username: string | null
  readonly isAdmin: boolean
}

const toKnownGroupContext = (row: KnownGroupContextRow): KnownGroupContext => ({
  contextId: row.contextId,
  provider: row.provider,
  displayName: row.displayName,
  parentName: row.parentName ?? null,
  firstSeenAt: row.firstSeenAt,
  lastSeenAt: row.lastSeenAt,
})

const toGroupAdminObservation = (row: GroupAdminObservationRow): GroupAdminObservation => ({
  contextId: row.contextId,
  userId: row.userId,
  username: row.username ?? null,
  isAdmin: row.isAdmin,
  lastSeenAt: row.lastSeenAt,
})

export function upsertKnownGroupContext(input: UpsertKnownGroupContextInput): void {
  log.debug({ contextId: input.contextId, provider: input.provider }, 'upsertKnownGroupContext called')

  const db = getDrizzleDb()

  const existing = db
    .select({ lastSeenAt: knownGroupContexts.lastSeenAt })
    .from(knownGroupContexts)
    .where(eq(knownGroupContexts.contextId, input.contextId))
    .get()

  if (existing !== undefined && isWithinThrottleWindow(existing.lastSeenAt)) {
    log.debug({ contextId: input.contextId }, 'Skipping group context upsert (throttled)')
    return
  }

  const now = new Date().toISOString()

  db.insert(knownGroupContexts)
    .values({
      contextId: input.contextId,
      provider: input.provider,
      displayName: input.displayName,
      parentName: input.parentName,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: knownGroupContexts.contextId,
      set: {
        provider: input.provider,
        displayName: input.displayName,
        parentName: input.parentName,
        lastSeenAt: now,
      },
    })
    .run()

  log.info({ contextId: input.contextId, provider: input.provider }, 'Known group context upserted')
}

export function upsertGroupAdminObservation(input: UpsertGroupAdminObservationInput): void {
  log.debug(
    { contextId: input.contextId, userId: input.userId, isAdmin: input.isAdmin },
    'upsertGroupAdminObservation called',
  )

  const db = getDrizzleDb()

  const existing = db
    .select({ lastSeenAt: groupAdminObservations.lastSeenAt })
    .from(groupAdminObservations)
    .where(and(eq(groupAdminObservations.contextId, input.contextId), eq(groupAdminObservations.userId, input.userId)))
    .get()

  if (existing !== undefined && isWithinThrottleWindow(existing.lastSeenAt)) {
    log.debug({ contextId: input.contextId, userId: input.userId }, 'Skipping admin observation upsert (throttled)')
    return
  }

  const now = new Date().toISOString()

  db.insert(groupAdminObservations)
    .values({
      contextId: input.contextId,
      userId: input.userId,
      username: input.username,
      isAdmin: input.isAdmin,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [groupAdminObservations.contextId, groupAdminObservations.userId],
      set: {
        username: input.username,
        isAdmin: input.isAdmin,
        lastSeenAt: now,
      },
    })
    .run()

  log.info(
    { contextId: input.contextId, userId: input.userId, isAdmin: input.isAdmin },
    'Group admin observation upserted',
  )
}

export function listKnownGroupContexts(): KnownGroupContext[] {
  log.debug('listKnownGroupContexts called')

  const groups = getDrizzleDb()
    .select()
    .from(knownGroupContexts)
    .all()
    .map(toKnownGroupContext)
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName))

  log.debug({ count: groups.length }, 'Listed known group contexts')
  return groups
}

export function listAdminGroupContextsForUser(userId: string): KnownGroupContext[] {
  log.debug({ userId }, 'listAdminGroupContextsForUser called')

  const groups = getDrizzleDb()
    .select({
      contextId: knownGroupContexts.contextId,
      provider: knownGroupContexts.provider,
      displayName: knownGroupContexts.displayName,
      parentName: knownGroupContexts.parentName,
      firstSeenAt: knownGroupContexts.firstSeenAt,
      lastSeenAt: knownGroupContexts.lastSeenAt,
    })
    .from(knownGroupContexts)
    .innerJoin(
      groupAdminObservations,
      and(
        eq(knownGroupContexts.contextId, groupAdminObservations.contextId),
        eq(groupAdminObservations.userId, userId),
        eq(groupAdminObservations.isAdmin, true),
      ),
    )
    .all()
    .map(toKnownGroupContext)
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName))

  log.debug({ userId, count: groups.length }, 'Listed admin group contexts for user')
  return groups
}

export function getGroupAdminObservation(contextId: string, userId: string): GroupAdminObservation | null {
  log.debug({ contextId, userId }, 'getGroupAdminObservation called')

  const row = getDrizzleDb()
    .select()
    .from(groupAdminObservations)
    .where(and(eq(groupAdminObservations.contextId, contextId), eq(groupAdminObservations.userId, userId)))
    .get()

  return row === undefined ? null : toGroupAdminObservation(row)
}
