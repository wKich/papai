import { z } from 'zod'

import type { Phase2Progress, Phase3Progress, Progress } from './progress.js'

const ExtractedBehaviorSchema = z.object({
  testName: z.string(),
  fullPath: z.string(),
  behavior: z.string(),
  context: z.string(),
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

const ConsolidatedBehaviorSchema = z.object({
  id: z.string(),
  domain: z.string(),
  featureName: z.string(),
  isUserFacing: z.boolean(),
  behavior: z.string(),
  userStory: z.string().nullable(),
  context: z.string(),
  sourceTestKeys: z.array(z.string()).readonly(),
})

const ConsolidatedBehaviorArraySchema = z.array(ConsolidatedBehaviorSchema).readonly()

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

const Phase2ProgressSchema = z.object({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedDomains: z.record(z.string(), z.literal('done')),
  consolidations: z.record(z.string(), ConsolidatedBehaviorArraySchema),
  failedDomains: z.record(z.string(), FailedEntrySchema),
  stats: z.object({
    domainsTotal: z.number(),
    domainsDone: z.number(),
    domainsFailed: z.number(),
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

const LegacyPhase2AsPhase3Schema = z.object({
  status: z.enum(['not-started', 'in-progress', 'done']).default('not-started'),
  completedBehaviors: z.record(z.string(), z.literal('done')).default({}),
  evaluations: z.record(z.string(), EvaluatedBehaviorSchema).default({}),
  failedBehaviors: z.record(z.string(), FailedEntrySchema).default({}),
  stats: z
    .object({
      behaviorsTotal: z.number(),
      behaviorsDone: z.number(),
      behaviorsFailed: z.number(),
    })
    .default({ behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 }),
})

function emptyPhase3(): Phase3Progress {
  return Phase3ProgressSchema.parse({
    status: 'not-started',
    completedBehaviors: {},
    evaluations: {},
    failedBehaviors: {},
    stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
  })
}

function migratePhase3FromLegacy(obj: Record<string, unknown>): Phase3Progress {
  const legacyPhase2 = obj['phase2']
  if (typeof legacyPhase2 === 'object' && legacyPhase2 !== null && 'evaluations' in legacyPhase2) {
    const parsed = LegacyPhase2AsPhase3Schema.safeParse(legacyPhase2)
    if (parsed.success) return Phase3ProgressSchema.parse(parsed.data)
  }
  return emptyPhase3()
}

function emptyPhase2(): Phase2Progress {
  return Phase2ProgressSchema.parse({
    status: 'not-started',
    completedDomains: {},
    consolidations: {},
    failedDomains: {},
    stats: { domainsTotal: 0, domainsDone: 0, domainsFailed: 0, behaviorsConsolidated: 0 },
  })
}

function emptyPhase1(): Progress['phase1'] {
  return Phase1ProgressSchema.parse({
    status: 'not-started',
    completedTests: {},
    extractedBehaviors: {},
    failedTests: {},
    completedFiles: [],
    stats: { filesTotal: 0, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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
  startedAt: z.string().default(new Date().toISOString()),
  phase1: LegacyPhase1Schema,
  phase2: z.record(z.string(), z.unknown()).default({}),
})

function migrateV1toV2(raw: unknown): Progress {
  const parsed = V1ProgressSchema.safeParse(raw)
  if (!parsed.success) {
    return ProgressV2Schema.parse({
      version: 2,
      startedAt: new Date().toISOString(),
      phase1: emptyPhase1(),
      phase2: emptyPhase2(),
      phase3: emptyPhase3(),
    })
  }
  const { startedAt, phase1 } = parsed.data
  const extractedBehaviors = isRecord(phase1.extractedBehaviors) ? phase1.extractedBehaviors : {}
  const migratedPhase1 = Phase1ProgressSchema.parse({ ...phase1, extractedBehaviors })
  const migratedPhase3 = isRecord(raw) ? migratePhase3FromLegacy(raw) : emptyPhase3()
  return ProgressV2Schema.parse({
    version: 2,
    startedAt,
    phase1: migratedPhase1,
    phase2: emptyPhase2(),
    phase3: migratedPhase3,
  })
}

export function validateOrMigrateProgress(raw: unknown): Progress | null {
  const v2Result = ProgressV2Schema.safeParse(raw)
  if (v2Result.success) return ProgressV2Schema.parse(v2Result.data)
  if (typeof raw === 'object' && raw !== null && 'startedAt' in raw && 'phase1' in raw) {
    return migrateV1toV2(raw)
  }
  return null
}
