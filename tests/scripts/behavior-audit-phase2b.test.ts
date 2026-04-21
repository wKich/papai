import { afterEach, expect, test } from 'bun:test'
import path from 'node:path'

import type { runPhase2b } from '../../scripts/behavior-audit/consolidate.js'
import type { Progress } from '../../scripts/behavior-audit/progress.js'
import { createClassifiedBehaviorFixture, createEmptyProgressFixture } from './behavior-audit-integration.helpers.js'
import { cleanupTempDirs } from './behavior-audit-integration.runtime-helpers.js'
import { getArrayItem, loadConsolidateModule } from './behavior-audit-integration.support.js'

function createEmptyProgress(filesTotal: number): Progress {
  return createEmptyProgressFixture(filesTotal)
}

afterEach(() => {
  cleanupTempDirs()
})

test('consolidate-agent prompt contract treats a keyword batch as a candidate pool rather than one feature', async () => {
  const source = await Bun.file(path.join(process.cwd(), 'scripts/behavior-audit/consolidate-agent.ts')).text()
  expect(source).toContain('candidate pool')
  expect(source).toContain('never force one output per batch or one output per keyword')
})

test('runPhase2b consolidates user-facing candidate features and preserves supporting internal refs', async () => {
  const consolidate = await loadConsolidateModule(crypto.randomUUID())
  const progress = createEmptyProgress(1)
  const writtenFiles = new Map<string, string>()

  progress.phase2a.classifiedBehaviors['tests/tools/create-task.test.ts::suite > create task'] =
    createClassifiedBehaviorFixture({
      behaviorId: 'tests/tools/create-task.test.ts::suite > create task',
      testKey: 'tests/tools/create-task.test.ts::suite > create task',
      domain: 'tools',
      behavior: 'When a user asks to create a task, the bot saves it.',
      context: 'Calls create_task.',
      keywords: ['task-create'],
      visibility: 'user-facing',
      candidateFeatureKey: 'task-creation',
      candidateFeatureLabel: 'Task creation',
      classificationNotes: 'User-facing task creation.',
    })
  progress.phase2a.classifiedBehaviors['tests/tools/create-task.test.ts::suite > validate input'] =
    createClassifiedBehaviorFixture({
      behaviorId: 'tests/tools/create-task.test.ts::suite > validate input',
      testKey: 'tests/tools/create-task.test.ts::suite > validate input',
      domain: 'tools',
      behavior: 'When input is malformed, the bot blocks task creation.',
      context: 'Runs validation guards.',
      keywords: ['task-create'],
      visibility: 'internal',
      candidateFeatureKey: 'task-creation',
      candidateFeatureLabel: 'Task creation',
      classificationNotes: 'Supporting validation behavior.',
    })

  const consolidateWithRetry = (): Promise<
    readonly {
      readonly id: string
      readonly item: {
        readonly featureName: string
        readonly isUserFacing: boolean
        readonly behavior: string
        readonly userStory: string | null
        readonly context: string
        readonly sourceBehaviorIds: string[]
        readonly sourceTestKeys: string[]
        readonly supportingInternalRefs: { behaviorId: string; summary: string }[]
      }
    }[]
  > =>
    Promise.resolve([
      {
        id: 'task-creation::task-creation',
        item: {
          featureName: 'Task creation',
          isUserFacing: true,
          behavior: 'When a user asks to create a task, the bot saves it and confirms success.',
          userStory: 'As a user, I want to create a task in chat so I can track work quickly.',
          context: 'Calls create_task and formats the confirmation.',
          sourceBehaviorIds: [
            'tests/tools/create-task.test.ts::suite > create task',
            'tests/tools/create-task.test.ts::suite > validate input',
          ],
          sourceTestKeys: [
            'tests/tools/create-task.test.ts::suite > create task',
            'tests/tools/create-task.test.ts::suite > validate input',
          ],
          supportingInternalRefs: [
            {
              behaviorId: 'tests/tools/create-task.test.ts::suite > validate input',
              summary: 'Validation guards prevent malformed task creation inputs.',
            },
          ],
        },
      },
    ])

  const manifest = await consolidate.runPhase2b(
    progress,
    { version: 1, entries: {} },
    'phase2-v2',
    new Set(['task-creation']),
    {
      consolidateWithRetry,
      writeConsolidatedFile: (domain, consolidations): Promise<void> => {
        writtenFiles.set(domain, JSON.stringify(consolidations, null, 2) + '\n')
        return Promise.resolve()
      },
    },
  )

  const entry = manifest.entries['task-creation::task-creation']
  if (entry === undefined) {
    throw new Error('Expected consolidated entry')
  }
  expect(entry.candidateFeatureKey).toBe('task-creation')
  expect(entry.sourceBehaviorIds).toEqual([
    'tests/tools/create-task.test.ts::suite > create task',
    'tests/tools/create-task.test.ts::suite > validate input',
  ])

  const fileText = writtenFiles.get('task-creation')
  if (fileText === undefined) {
    throw new Error('Expected consolidated file contents to be captured')
  }
  expect(fileText).toContain('supportingInternalRefs')
})

test('runPhase2b groups classified behaviors by candidate feature and preserves provenance', async () => {
  const consolidate: { readonly runPhase2b: typeof runPhase2b } =
    await import('../../scripts/behavior-audit/consolidate.js')
  const progress = createEmptyProgress(2)
  let capturedCandidateFeatureKey: string | null = null
  let capturedDomains: readonly string[] = []

  progress.phase2a.classifiedBehaviors['tests/tools/a.test.ts::suite > case'] = createClassifiedBehaviorFixture({
    behaviorId: 'tests/tools/a.test.ts::suite > case',
    testKey: 'tests/tools/a.test.ts::suite > case',
    domain: 'tools',
    behavior: 'When a user targets a group, the bot routes the request correctly.',
    context: 'Routes through group context selection.',
    keywords: ['group-targeting', 'shared-feature'],
    visibility: 'user-facing',
    candidateFeatureKey: 'group-targeting',
    candidateFeatureLabel: 'Group targeting',
    classificationNotes: 'User-facing feature.',
  })
  progress.phase2a.classifiedBehaviors['tests/commands/b.test.ts::suite > case'] = createClassifiedBehaviorFixture({
    behaviorId: 'tests/commands/b.test.ts::suite > case',
    testKey: 'tests/commands/b.test.ts::suite > case',
    domain: 'commands',
    behavior: 'When a user configures a group action, the bot applies the group target.',
    context: 'Resolves group target before command execution.',
    keywords: ['group-targeting', 'shared-feature'],
    visibility: 'internal',
    candidateFeatureKey: 'group-targeting',
    candidateFeatureLabel: 'Group targeting',
    classificationNotes: 'Supporting internal behavior.',
  })

  const consolidateWithRetry = (
    candidateFeatureKey: string,
    inputs: readonly { readonly testKey: string; readonly domain: string; readonly behaviorId: string }[],
  ): Promise<
    | readonly {
        readonly id: string
        readonly item: {
          readonly featureName: string
          readonly isUserFacing: boolean
          readonly behavior: string
          readonly userStory: string | null
          readonly context: string
          readonly sourceTestKeys: string[]
          readonly sourceBehaviorIds: string[]
          readonly supportingInternalRefs: { behaviorId: string; summary: string }[]
        }
      }[]
    | null
  > => {
    capturedCandidateFeatureKey = candidateFeatureKey
    capturedDomains = inputs.map((input) => input.domain)

    return Promise.resolve([
      {
        id: `${candidateFeatureKey}::combined-feature`,
        item: {
          featureName: 'Combined feature',
          isUserFacing: true,
          behavior: 'When a user acts, something happens.',
          userStory: 'As a user, I can do something.',
          context: 'Implementation context.',
          sourceTestKeys: inputs.map((input) => input.testKey),
          sourceBehaviorIds: inputs.map((input) => input.behaviorId),
          supportingInternalRefs: [],
        },
      },
    ])
  }

  const result = await consolidate.runPhase2b(
    progress,
    { version: 1, entries: {} },
    'phase2-v1',
    new Set(['group-targeting']),
    {
      consolidateWithRetry,
      writeConsolidatedFile: async (): Promise<void> => {},
    },
  )

  expect(Object.keys(result.entries).length).toBeGreaterThan(0)
  if (capturedCandidateFeatureKey === null) {
    throw new Error('Expected captured candidate feature key')
  }
  expect(capturedCandidateFeatureKey === 'group-targeting').toBe(true)
  expect(capturedDomains).toEqual(['tools', 'commands'])
  const savedEntries = Object.values(result.entries)
  expect(savedEntries).toHaveLength(1)
  expect(getArrayItem(savedEntries, 0).domain).toBe('cross-domain')
  expect(getArrayItem(savedEntries, 0).sourceDomains).toEqual(['commands', 'tools'])
})
