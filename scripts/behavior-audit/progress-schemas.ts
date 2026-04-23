import { z } from 'zod'

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

const Phase1CheckpointSchema = z.strictObject({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedTests: z.record(z.string(), z.record(z.string(), z.literal('done'))),
  failedTests: z.record(z.string(), FailedEntrySchema),
  completedFiles: z.array(z.string()),
  stats: z.object({
    filesTotal: z.number(),
    filesDone: z.number(),
    testsExtracted: z.number(),
    testsFailed: z.number(),
  }),
})

const Phase2aCheckpointSchema = z.strictObject({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedBehaviors: z.record(z.string(), z.literal('done')),
  failedBehaviors: z.record(z.string(), FailedEntrySchema),
  stats: z.object({
    behaviorsTotal: z.number(),
    behaviorsDone: z.number(),
    behaviorsFailed: z.number(),
  }),
})

const Phase2bCheckpointSchema = z.strictObject({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedFeatureKeys: z.record(z.string(), z.literal('done')),
  failedFeatureKeys: z.record(z.string(), FailedEntrySchema),
  stats: z.object({
    featureKeysTotal: z.number(),
    featureKeysDone: z.number(),
    featureKeysFailed: z.number(),
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

const Phase3CheckpointSchema = z.strictObject({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedConsolidatedIds: z.record(z.string(), z.literal('done')),
  failedConsolidatedIds: z.record(z.string(), FailedEntrySchema),
  stats: z.object({
    consolidatedIdsTotal: z.number(),
    consolidatedIdsDone: z.number(),
    consolidatedIdsFailed: z.number(),
  }),
})

export const ProgressV2Schema = z.object({
  version: z.literal(2),
  startedAt: z.string(),
  phase1: z.object({
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
  }),
  phase2: Phase2ProgressSchema,
  phase3: z.object({
    status: z.enum(['not-started', 'in-progress', 'done']),
    completedBehaviors: z.record(z.string(), z.literal('done')),
    evaluations: z.record(z.string(), EvaluatedBehaviorSchema),
    failedBehaviors: z.record(z.string(), FailedEntrySchema),
    stats: z.object({
      behaviorsTotal: z.number(),
      behaviorsDone: z.number(),
      behaviorsFailed: z.number(),
    }),
  }),
})

export const LegacyProgressV3Schema = z.object({
  version: z.literal(3),
  startedAt: z.string(),
  phase1: z.object({
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
  }),
  phase2a: z.object({
    status: z.enum(['not-started', 'in-progress', 'done']),
    completedBehaviors: z.record(z.string(), z.literal('done')),
    classifiedBehaviors: z.record(z.string(), ClassifiedBehaviorSchema),
    failedBehaviors: z.record(z.string(), FailedEntrySchema),
    stats: z.object({
      behaviorsTotal: z.number(),
      behaviorsDone: z.number(),
      behaviorsFailed: z.number(),
    }),
  }),
  phase2b: z.object({
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
  }),
  phase3: z.object({
    status: z.enum(['not-started', 'in-progress', 'done']),
    completedBehaviors: z.record(z.string(), z.literal('done')),
    evaluations: z.record(z.string(), EvaluatedBehaviorSchema),
    failedBehaviors: z.record(z.string(), FailedEntrySchema),
    stats: z.object({
      behaviorsTotal: z.number(),
      behaviorsDone: z.number(),
      behaviorsFailed: z.number(),
    }),
  }),
})

export const ProgressV4Schema = z.strictObject({
  version: z.literal(4),
  startedAt: z.string(),
  phase1: Phase1CheckpointSchema,
  phase2a: Phase2aCheckpointSchema,
  phase2b: Phase2bCheckpointSchema,
  phase3: Phase3CheckpointSchema,
})

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

export const V1ProgressSchema = z.looseObject({
  startedAt: z.string().default(() => new Date().toISOString()),
  phase1: LegacyPhase1Schema,
  phase2: z.record(z.string(), z.unknown()).default({}),
})
