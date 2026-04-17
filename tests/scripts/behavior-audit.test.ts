import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type * as EvaluateAgentModule from '../../scripts/behavior-audit/evaluate-agent.js'
import type * as EvaluateModule from '../../scripts/behavior-audit/evaluate.js'
import type * as ProgressModule from '../../scripts/behavior-audit/progress.js'
import type { ExtractedBehavior, EvaluatedBehavior } from '../../scripts/behavior-audit/report-writer.js'
import type * as ReportWriterModule from '../../scripts/behavior-audit/report-writer.js'
import { getToolExecutor } from '../utils/test-helpers.js'

const tempDirs: string[] = []
let currentRoot: string | null = null

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isProgressModule(value: unknown): value is typeof ProgressModule {
  return (
    isObject(value) &&
    'createEmptyProgress' in value &&
    typeof value['createEmptyProgress'] === 'function' &&
    'saveProgress' in value &&
    typeof value['saveProgress'] === 'function' &&
    'markBehaviorDone' in value &&
    typeof value['markBehaviorDone'] === 'function'
  )
}

function isReportWriterModule(value: unknown): value is typeof ReportWriterModule {
  return isObject(value) && 'writeBehaviorFile' in value && typeof value['writeBehaviorFile'] === 'function'
}

function isEvaluateModule(value: unknown): value is typeof EvaluateModule {
  return isObject(value) && 'runPhase2' in value && typeof value['runPhase2'] === 'function'
}

function isEvaluateAgentModule(value: unknown): value is typeof EvaluateAgentModule {
  return isObject(value) && 'evaluateWithRetry' in value && typeof value['evaluateWithRetry'] === 'function'
}

async function loadProgressModule(tag: string): Promise<typeof ProgressModule> {
  const mod: unknown = await import(`../../scripts/behavior-audit/progress.js?resume=${tag}`)
  if (!isProgressModule(mod)) throw new Error('Unexpected progress module shape')
  return mod
}

async function loadReportWriterModule(tag: string): Promise<typeof ReportWriterModule> {
  const mod: unknown = await import(`../../scripts/behavior-audit/report-writer.js?resume=${tag}`)
  if (!isReportWriterModule(mod)) throw new Error('Unexpected report writer module shape')
  return mod
}

async function loadEvaluateModule(tag: string): Promise<typeof EvaluateModule> {
  const mod: unknown = await import(`../../scripts/behavior-audit/evaluate.js?resume=${tag}`)
  if (!isEvaluateModule(mod)) throw new Error('Unexpected evaluate module shape')
  return mod
}

async function loadEvaluateAgentModule(tag: string): Promise<typeof EvaluateAgentModule> {
  const mod: unknown = await import(`../../scripts/behavior-audit/evaluate-agent.js?test=${tag}`)
  if (!isEvaluateAgentModule(mod)) throw new Error('Unexpected evaluate-agent module shape')
  return mod
}

async function loadBehaviorAuditEntryPoint(tag: string): Promise<void> {
  await import(`../../scripts/behavior-audit.ts?test=${tag}`)
}

async function runCommand(command: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const errorMessage = stderr.trim()
    if (errorMessage.length > 0) {
      throw new Error(errorMessage)
    }
    throw new Error(`Command failed: ${command.join(' ')}`)
  }
  return stdout.trim()
}

async function initializeGitRepo(root: string): Promise<void> {
  await runCommand(['git', 'init', '-q'], root)
  await runCommand(
    [
      'git',
      '-c',
      'user.name=Test User',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'init',
      '-q',
    ],
    root,
  )
}

function isSavedManifest(
  value: unknown,
): value is { readonly lastStartCommit: string | null; readonly lastStartedAt: string | null } {
  if (!isObject(value)) {
    return false
  }
  if (!('lastStartCommit' in value) || !('lastStartedAt' in value)) {
    return false
  }

  const lastStartCommit = value['lastStartCommit']
  if (typeof lastStartCommit !== 'string' && lastStartCommit !== null) {
    return false
  }

  const lastStartedAt = value['lastStartedAt']
  if (typeof lastStartedAt !== 'string' && lastStartedAt !== null) {
    return false
  }

  return true
}

const makeTempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'behavior-audit-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  currentRoot = null
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('behavior-audit progress', () => {
  test('markTestDone is idempotent for repeated completions', async () => {
    const progressModule = await import('../../scripts/behavior-audit/progress.js')
    const progress = progressModule.createEmptyProgress(1)
    const behavior: ExtractedBehavior = {
      testName: 'extracts behavior',
      fullPath: 'suite > extracts behavior',
      behavior: 'When the user asks for help, the bot replies with help text.',
      context: 'Calls help handler.',
    }

    progressModule.markTestDone(
      progress,
      'tests/tools/help.test.ts',
      'tests/tools/help.test.ts::suite > extracts behavior',
      behavior,
    )
    progressModule.markTestDone(
      progress,
      'tests/tools/help.test.ts',
      'tests/tools/help.test.ts::suite > extracts behavior',
      behavior,
    )

    expect(progress.phase1.stats.testsExtracted).toBe(1)
    expect(progress.phase1.completedTests['tests/tools/help.test.ts']).toEqual({
      'tests/tools/help.test.ts::suite > extracts behavior': 'done',
    })
    expect(progress.phase1.extractedBehaviors['tests/tools/help.test.ts::suite > extracts behavior']).toEqual(behavior)
  })

  test('markBehaviorDone is idempotent and stores evaluation payloads', async () => {
    const progressModule = await import('../../scripts/behavior-audit/progress.js')
    const progress = progressModule.createEmptyProgress(1)
    const evaluation: EvaluatedBehavior = {
      testName: 'evaluates behavior',
      behavior: 'When the user asks what is due, the bot summarizes due tasks.',
      userStory: 'As a user, I want to ask what is due so that I can plan my work.',
      maria: { discover: 4, use: 4, retain: 4, notes: 'Clear enough.' },
      dani: { discover: 4, use: 3, retain: 3, notes: 'Helpful but a bit rigid.' },
      viktor: { discover: 3, use: 4, retain: 4, notes: 'Would use it with guidance.' },
      flaws: ['Could be more conversational'],
      improvements: ['Add a friendlier example prompt'],
    }

    progressModule.markBehaviorDone(progress, 'tests/tools/list.test.ts::lists due work', evaluation)
    progressModule.markBehaviorDone(progress, 'tests/tools/list.test.ts::lists due work', evaluation)

    expect(progress.phase2.stats.behaviorsDone).toBe(1)
    expect(progress.phase2.completedBehaviors['tests/tools/list.test.ts::lists due work']).toBe('done')
    expect(progress.phase2.evaluations['tests/tools/list.test.ts::lists due work']).toEqual(evaluation)
  })
})

describe('behavior-audit resume', () => {
  beforeEach(() => {
    const root = makeTempDir()
    currentRoot = root
    const reportsDir = path.join(root, 'reports')
    const behaviorsDir = path.join(reportsDir, 'behaviors')
    const storiesDir = path.join(reportsDir, 'stories')
    const progressPath = path.join(reportsDir, 'progress.json')

    void mock.module('../../scripts/behavior-audit/config.js', () => ({
      MODEL: 'qwen3-30b-a3b',
      BASE_URL: 'http://localhost:1234/v1',
      PROJECT_ROOT: root,
      REPORTS_DIR: reportsDir,
      BEHAVIORS_DIR: behaviorsDir,
      STORIES_DIR: storiesDir,
      PROGRESS_PATH: progressPath,
      PHASE1_TIMEOUT_MS: 1_200_000,
      PHASE2_TIMEOUT_MS: 600_000,
      MAX_RETRIES: 3,
      RETRY_BACKOFF_MS: [100_000, 300_000, 900_000] as const,
      MAX_STEPS: 20,
      EXCLUDED_PREFIXES: [
        'tests/e2e/',
        'tests/client/',
        'tests/helpers/',
        'tests/scripts/',
        'tests/review-loop/',
        'tests/types/',
      ] as const,
    }))
  })

  test('runPhase2 rewrites reports from persisted completed evaluations when everything is skipped on resume', async () => {
    if (currentRoot === null) throw new Error('currentRoot not initialized')

    void mock.module('../../scripts/behavior-audit/evaluate-agent.js', () => ({
      evaluateWithRetry: (): Promise<null> => Promise.resolve(null),
    }))

    const moduleTag = crypto.randomUUID()
    const progressModule = await loadProgressModule(moduleTag)
    const reportWriterModule = await loadReportWriterModule(moduleTag)
    const { runPhase2 } = await loadEvaluateModule(moduleTag)

    const progress = progressModule.createEmptyProgress(1)
    const evaluation: EvaluatedBehavior = {
      testName: 'lists open tasks',
      behavior: 'When the user asks for open tasks, the bot lists them in chat.',
      userStory: 'As a user, I want to see my open tasks so that I know what to do next.',
      maria: { discover: 4, use: 5, retain: 4, notes: 'Easy to understand.' },
      dani: { discover: 4, use: 4, retain: 4, notes: 'Natural enough.' },
      viktor: { discover: 3, use: 4, retain: 4, notes: 'Would appreciate examples.' },
      flaws: ['Lacks example prompts'],
      improvements: ['Show a sample request in help text'],
    }

    progressModule.markBehaviorDone(
      progress,
      'tests/tools/list-tasks.test.ts::list tasks > lists open tasks',
      evaluation,
    )
    await progressModule.saveProgress(progress)

    await reportWriterModule.writeBehaviorFile('tests/tools/list-tasks.test.ts', [
      {
        testName: 'lists open tasks',
        fullPath: 'list tasks > lists open tasks',
        behavior: evaluation.behavior,
        context: 'Delegates to list_tasks and formats a reply.',
      },
    ])

    await runPhase2(progress)

    const configuredStoriesPath = path.join(currentRoot, 'reports', 'stories', 'tools.md')
    const configuredIndexPath = path.join(currentRoot, 'reports', 'stories', 'index.md')

    expect(existsSync(configuredStoriesPath)).toBe(true)
    expect(existsSync(configuredIndexPath)).toBe(true)
    expect(readFileSync(configuredStoriesPath, 'utf8')).toContain('lists open tasks')
    expect(readFileSync(configuredIndexPath, 'utf8')).toContain('tools')
    expect(readFileSync(configuredIndexPath, 'utf8')).toContain('Lacks example prompts')
  })
})

describe('behavior-audit startup', () => {
  let manifestPath: string
  let phase1ManifestSnapshot: string | null
  let phase1Calls: number

  beforeEach(() => {
    const root = makeTempDir()
    currentRoot = root
    const reportsDir = path.join(root, 'reports')
    const behaviorsDir = path.join(reportsDir, 'behaviors')
    const storiesDir = path.join(reportsDir, 'stories')
    const progressPath = path.join(reportsDir, 'progress.json')
    manifestPath = path.join(reportsDir, 'incremental-manifest.json')
    const testsDir = path.join(root, 'tests', 'tools')
    phase1ManifestSnapshot = null
    phase1Calls = 0

    mkdirSync(testsDir, { recursive: true })
    writeFileSync(path.join(testsDir, 'sample.test.ts'), "test('sample', () => {})\n")

    void mock.module('../../scripts/behavior-audit/config.js', () => ({
      MODEL: 'qwen3-30b-a3b',
      BASE_URL: 'http://localhost:1234/v1',
      PROJECT_ROOT: root,
      REPORTS_DIR: reportsDir,
      BEHAVIORS_DIR: behaviorsDir,
      STORIES_DIR: storiesDir,
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: manifestPath,
      PHASE1_TIMEOUT_MS: 1_200_000,
      PHASE2_TIMEOUT_MS: 600_000,
      MAX_RETRIES: 3,
      RETRY_BACKOFF_MS: [100_000, 300_000, 900_000] as const,
      MAX_STEPS: 20,
      EXCLUDED_PREFIXES: [
        'tests/e2e/',
        'tests/client/',
        'tests/helpers/',
        'tests/scripts/',
        'tests/review-loop/',
        'tests/types/',
      ] as const,
    }))
    void mock.module('../../scripts/behavior-audit/extract.js', () => ({
      runPhase1: async (): Promise<void> => {
        phase1Calls += 1
        phase1ManifestSnapshot = await Bun.file(manifestPath).text()
      },
    }))
    void mock.module('../../scripts/behavior-audit/evaluate.js', () => ({
      runPhase2: async (): Promise<void> => {},
    }))
  })

  test('startup writes lastStartCommit to the manifest before phase execution', async () => {
    if (currentRoot === null) throw new Error('currentRoot not initialized')

    await initializeGitRepo(currentRoot)
    const currentHead = await runCommand(['git', 'rev-parse', 'HEAD'], currentRoot)

    await loadBehaviorAuditEntryPoint(crypto.randomUUID())

    const savedManifestJson: unknown = JSON.parse(await Bun.file(manifestPath).text())
    if (!isSavedManifest(savedManifestJson)) {
      throw new Error('Saved manifest shape mismatch')
    }
    const savedManifest = savedManifestJson

    expect(savedManifest.lastStartCommit).toBe(currentHead)
    expect(savedManifest.lastStartedAt).not.toBeNull()
    expect(phase1Calls).toBe(1)
    expect(phase1ManifestSnapshot).not.toBeNull()
    if (phase1ManifestSnapshot === null) {
      throw new Error('Expected phase1 manifest snapshot')
    }
    expect(JSON.parse(phase1ManifestSnapshot)).toMatchObject({
      lastStartCommit: currentHead,
    })
  })

  test('startup stops on corrupt manifest before overwriting it', async () => {
    if (currentRoot === null) throw new Error('currentRoot not initialized')

    await initializeGitRepo(currentRoot)

    await Bun.write(manifestPath, '{broken json')

    const errorCalls: string[] = []
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation((...args: readonly unknown[]) => {
      errorCalls.push(args.map(String).join(' '))
    })
    const processExitSpy = spyOn(process, 'exit').mockImplementation(((code: number | undefined) => {
      if (code === undefined) {
        throw new Error('process.exit:0')
      }
      throw new Error(`process.exit:${code}`)
    }) as typeof process.exit)

    await expect(loadBehaviorAuditEntryPoint(crypto.randomUUID())).rejects.toThrow('process.exit:1')
    expect(await Bun.file(manifestPath).text()).toBe('{broken json')
    expect(errorCalls.some((line) => line.includes('Fatal error:'))).toBe(true)
    expect(phase1Calls).toBe(0)

    consoleErrorSpy.mockRestore()
    processExitSpy.mockRestore()
  })
})

describe('behavior-audit tools', () => {
  test('readFile rejects project sibling traversal and grep rejects unsafe directories', async () => {
    const { makeAuditTools } = await import('../../scripts/behavior-audit/tools.js')
    const tools = makeAuditTools()
    const readFile = getToolExecutor(tools['readFile'])
    const grep = getToolExecutor(tools['grep'])

    await expect(readFile({ path: '../papai-sibling/package.json' })).resolves.toBe(
      'Error: path "../papai-sibling/package.json" resolves outside project',
    )
    await expect(grep({ pattern: 'anything', directory: '..' })).resolves.toBe(
      'Error: directory ".." resolves outside project',
    )
  })
})

describe('behavior-audit evaluate-agent', () => {
  test('evaluateWithRetry rejects partial JSON payloads instead of accepting malformed results', async () => {
    void mock.module('../../scripts/behavior-audit/config.js', () => ({
      MODEL: 'qwen3-30b-a3b',
      BASE_URL: 'http://localhost:1234/v1',
      PROJECT_ROOT: '/tmp/project-root',
      REPORTS_DIR: '/tmp/project-root/reports',
      BEHAVIORS_DIR: '/tmp/project-root/reports/behaviors',
      STORIES_DIR: '/tmp/project-root/reports/stories',
      PROGRESS_PATH: '/tmp/project-root/reports/progress.json',
      PHASE1_TIMEOUT_MS: 1,
      PHASE2_TIMEOUT_MS: 1,
      MAX_RETRIES: 2,
      RETRY_BACKOFF_MS: [1, 1, 1] as const,
      MAX_STEPS: 1,
      EXCLUDED_PREFIXES: [] as const,
    }))
    void mock.module('ai', () => ({
      generateText: (): Promise<{ text: string }> =>
        Promise.resolve({
          text: JSON.stringify({
            userStory: 'As a user, I want to list tasks so that I can see them.',
            maria: { discover: 4, use: 4, retain: 4, notes: 'Fine.' },
          }),
        }),
      stepCountIs: (_n: number): undefined => undefined,
      tool: <T>(value: T): T => value,
    }))
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible:
        (): ((_model: string) => string) =>
        (_model: string): string =>
          'mock-model',
    }))

    const { evaluateWithRetry } = await loadEvaluateAgentModule(crypto.randomUUID())

    await expect(evaluateWithRetry('prompt')).resolves.toBeNull()
  })
})
