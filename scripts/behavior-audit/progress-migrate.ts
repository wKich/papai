import { MAX_RETRIES } from './config.js'
import { LegacyProgressV3Schema, ProgressV2Schema, ProgressV4Schema, V1ProgressSchema } from './progress-schemas.js'
import { emptyPhase2a, emptyPhase2b, emptyPhase3, type Progress } from './progress.js'

function normalizePhase2aFailedAttempts(progress: Progress): Progress {
  return {
    ...progress,
    phase2a: {
      ...progress.phase2a,
      failedBehaviors: Object.fromEntries(
        Object.entries(progress.phase2a.failedBehaviors).map(([behaviorId, entry]) => [
          behaviorId,
          {
            ...entry,
            attempts:
              progress.phase2a.completedBehaviors[behaviorId] === 'done'
                ? entry.attempts
                : Math.max(entry.attempts, MAX_RETRIES),
          },
        ]),
      ),
    },
  }
}

function toVersion4Progress(input: {
  readonly startedAt: string
  readonly phase1: Progress['phase1']
  readonly phase2a?: Partial<Progress['phase2a']>
  readonly phase2b?: Partial<Progress['phase2b']>
  readonly phase3?: Partial<Progress['phase3']>
}): Progress {
  return normalizePhase2aFailedAttempts(
    ProgressV4Schema.parse({
      version: 4,
      startedAt: input.startedAt,
      phase1: input.phase1,
      phase2a: {
        ...emptyPhase2a(),
        ...input.phase2a,
      },
      phase2b: {
        ...emptyPhase2b(),
        ...input.phase2b,
      },
      phase3: {
        ...emptyPhase3(),
        ...input.phase3,
      },
    }),
  )
}

function createIncompatibleResetProgress(startedAt: string): Progress {
  return toVersion4Progress({
    startedAt,
    phase1: {
      status: 'not-started',
      completedTests: {},
      failedTests: {},
      completedFiles: [],
      stats: { filesTotal: 0, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
    },
  })
}

function migrateV1toV2(raw: unknown): Progress {
  const parsed = V1ProgressSchema.parse(raw)
  return createIncompatibleResetProgress(parsed.startedAt)
}

function migrateV2toV3(raw: unknown): Progress {
  const parsed = ProgressV2Schema.parse(raw)
  return createIncompatibleResetProgress(parsed.startedAt)
}

function migrateV3toV4(raw: unknown): Progress {
  const parsed = LegacyProgressV3Schema.parse(raw)
  return createIncompatibleResetProgress(parsed.startedAt)
}

export function validateOrMigrateProgress(raw: unknown): Progress | null {
  const v4Result = ProgressV4Schema.safeParse(raw)
  if (v4Result.success) return v4Result.data

  const v3Result = LegacyProgressV3Schema.safeParse(raw)
  if (v3Result.success) return migrateV3toV4(v3Result.data)

  const v2Result = ProgressV2Schema.safeParse(raw)
  if (v2Result.success) return migrateV2toV3(v2Result.data)

  if (typeof raw === 'object' && raw !== null && 'phase1' in raw) {
    return migrateV1toV2(raw)
  }
  return null
}
