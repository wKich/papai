import { z } from 'zod'

import { MAX_RETRIES } from './config.js'
import {
  emptyPhase2a,
  emptyPhase2b,
  emptyPhase3,
  type Phase2aProgress,
  type Phase2bProgress,
  type Phase3Progress,
  type Progress,
} from './progress.js'

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

const ExtractedBehaviorSchema = z.object({
  testName: z.string(),
  fullPath: z.string(),
  behavior: z.string(),
  context: z.string(),
  keywords: z.array(z.string()).readonly(),
})

const PersonaScoreSchema = z.object({
  discover: z.number(),
  use: z.number(),
  retain: z.number(),
  notes: z.string(),
})

const EvaluatedBehaviorSchema = z.object({
  testName: z.string(),
  behavior: z.string(),
  userStory: z.string(),
  maria: PersonaScoreSchema,
  dani: PersonaScoreSchema,
  viktor: PersonaScoreSchema,
  flaws: z.array(z.string()),
  improvements: z.array(z.string()),
})

const LegacyV2ConsolidatedBehaviorSchema = z.object({
  id: z.string(),
  domain: z.string(),
  featureName: z.string(),
  isUserFacing: z.boolean(),
  behavior: z.string(),
  userStory: z.string().nullable(),
  context: z.string(),
  sourceTestKeys: z.array(z.string()).readonly(),
})

const LegacyV2ConsolidatedBehaviorArraySchema = z.array(LegacyV2ConsolidatedBehaviorSchema).readonly()

const ConsolidatedBehaviorSchema = z.object({
  id: z.string(),
  domain: z.string(),
  featureName: z.string(),
  isUserFacing: z.boolean(),
  behavior: z.string(),
  userStory: z.string().nullable(),
  context: z.string(),
  sourceTestKeys: z.array(z.string()).readonly(),
  sourceBehaviorIds: z.array(z.string()).readonly(),
  supportingInternalRefs: z.array(z.object({ behaviorId: z.string(), summary: z.string() }).readonly()).readonly(),
})

const ConsolidatedBehaviorArraySchema = z.array(ConsolidatedBehaviorSchema).readonly()

const RelatedBehaviorHintSchema = z
  .object({
    testKey: z.string(),
    relation: z.enum(['same-feature', 'supporting-detail', 'possibly-related']),
    reason: z.string(),
  })
  .readonly()

const SupportingBehaviorRefSchema = z
  .object({
    behaviorId: z.string(),
    reason: z.string(),
  })
  .readonly()

const ClassifiedBehaviorSchema = z.object({
  behaviorId: z.string(),
  testKey: z.string(),
  domain: z.string(),
  behavior: z.string(),
  context: z.string(),
  keywords: z.array(z.string()).readonly(),
  visibility: z.enum(['user-facing', 'internal', 'ambiguous']),
  candidateFeatureKey: z.string().nullable(),
  candidateFeatureLabel: z.string().nullable(),
  supportingBehaviorRefs: z.array(SupportingBehaviorRefSchema).readonly(),
  relatedBehaviorHints: z.array(RelatedBehaviorHintSchema).readonly(),
  classificationNotes: z.string(),
})

const FailedEntrySchema = z.object({
  error: z.string(),
  attempts: z.number(),
  lastAttempt: z.string(),
})

const Phase1ProgressSchema = z.object({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedTests: z.record(z.string(), z.record(z.string(), z.literal('done'))),
  extractedBehaviors: z.record(z.string(), ExtractedBehaviorSchema),
  failedTests: z.record(z.string(), FailedEntrySchema),
  completedFiles: z.array(z.string()),
  stats: z.object({
    filesTotal: z.number(),
    filesDone: z.number(),
    testsExtracted: z.number(),
    testsFailed: z.number(),
  }),
})

const Phase2aProgressSchema = z.object({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedBehaviors: z.record(z.string(), z.literal('done')),
  classifiedBehaviors: z.record(z.string(), ClassifiedBehaviorSchema),
  failedBehaviors: z.record(z.string(), FailedEntrySchema),
  stats: z.object({
    behaviorsTotal: z.number(),
    behaviorsDone: z.number(),
    behaviorsFailed: z.number(),
  }),
})

const Phase2bProgressSchema = z.object({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedCandidateFeatures: z.record(z.string(), z.literal('done')),
  consolidations: z.record(z.string(), ConsolidatedBehaviorArraySchema),
  failedCandidateFeatures: z.record(z.string(), FailedEntrySchema),
  stats: z.object({
    candidateFeaturesTotal: z.number(),
    candidateFeaturesDone: z.number(),
    candidateFeaturesFailed: z.number(),
    behaviorsConsolidated: z.number(),
  }),
})

const Phase2ProgressSchema = z.object({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedBatches: z.record(z.string(), z.literal('done')),
  consolidations: z.record(z.string(), LegacyV2ConsolidatedBehaviorArraySchema),
  failedBatches: z.record(z.string(), FailedEntrySchema),
  stats: z.object({
    batchesTotal: z.number(),
    batchesDone: z.number(),
    batchesFailed: z.number(),
    behaviorsConsolidated: z.number(),
  }),
})

const Phase3ProgressSchema = z.object({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedBehaviors: z.record(z.string(), z.literal('done')),
  evaluations: z.record(z.string(), EvaluatedBehaviorSchema),
  failedBehaviors: z.record(z.string(), FailedEntrySchema),
  stats: z.object({
    behaviorsTotal: z.number(),
    behaviorsDone: z.number(),
    behaviorsFailed: z.number(),
  }),
})

const ProgressV2Schema = z.object({
  version: z.literal(2),
  startedAt: z.string(),
  phase1: Phase1ProgressSchema,
  phase2: Phase2ProgressSchema,
  phase3: Phase3ProgressSchema,
})

const ProgressV3Schema = z.object({
  version: z.literal(3),
  startedAt: z.string(),
  phase1: Phase1ProgressSchema,
  phase2a: Phase2aProgressSchema,
  phase2b: Phase2bProgressSchema,
  phase3: Phase3ProgressSchema,
})

function parseEmptyPhase2a(): Phase2aProgress {
  return Phase2aProgressSchema.parse(emptyPhase2a())
}

function parseEmptyPhase2b(): Phase2bProgress {
  return Phase2bProgressSchema.parse(emptyPhase2b())
}

function parseEmptyPhase3(): Phase3Progress {
  return Phase3ProgressSchema.parse(emptyPhase3())
}

const LegacyPhase1Schema = z.looseObject({
  status: z.enum(['not-started', 'in-progress', 'done']).default('not-started'),
  completedTests: z.record(z.string(), z.record(z.string(), z.literal('done'))).default({}),
  extractedBehaviors: z.record(z.string(), ExtractedBehaviorSchema).default({}),
  failedTests: z.record(z.string(), FailedEntrySchema).default({}),
  completedFiles: z.array(z.string()).default([]),
  stats: z.object({
    filesTotal: z.number(),
    filesDone: z.number(),
    testsExtracted: z.number(),
    testsFailed: z.number(),
  }),
})

const V1ProgressSchema = z.looseObject({
  startedAt: z.string().default(() => new Date().toISOString()),
  phase1: LegacyPhase1Schema,
  phase2: z.record(z.string(), z.unknown()).default({}),
})

function migrateV1toV2(raw: unknown): Progress {
  const parsed = V1ProgressSchema.parse(raw)
  return ProgressV3Schema.parse({
    version: 3,
    startedAt: parsed.startedAt,
    phase1: Phase1ProgressSchema.parse(parsed.phase1),
    phase2a: parseEmptyPhase2a(),
    phase2b: parseEmptyPhase2b(),
    phase3: parseEmptyPhase3(),
  })
}

function migrateV2toV3(raw: unknown): Progress {
  const parsed = ProgressV2Schema.parse(raw)
  return ProgressV3Schema.parse({
    version: 3,
    startedAt: parsed.startedAt,
    phase1: parsed.phase1,
    phase2a: parseEmptyPhase2a(),
    phase2b: parseEmptyPhase2b(),
    phase3: parseEmptyPhase3(),
  })
}

export function validateOrMigrateProgress(raw: unknown): Progress | null {
  const v3Result = ProgressV3Schema.safeParse(raw)
  if (v3Result.success) return normalizePhase2aFailedAttempts(ProgressV3Schema.parse(v3Result.data))

  const v2Result = ProgressV2Schema.safeParse(raw)
  if (v2Result.success) return migrateV2toV3(v2Result.data)

  if (typeof raw === 'object' && raw !== null && 'phase1' in raw) {
    return migrateV1toV2(raw)
  }
  return null
}
