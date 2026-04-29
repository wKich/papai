import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs, tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { makeToolProxy } from '../src/tools/tool-proxy.js'

export type BenchmarkMode = 'direct' | 'proxy'
type BenchmarkCounts = Record<'toolCallCount' | 'stepCount', number>
export type BenchmarkResult = Readonly<
  Record<'model' | 'scenario', string> &
    BenchmarkCounts & { mode: BenchmarkMode; success: boolean; failureCategory: string | null }
>
export type BenchmarkArgs = Readonly<
  Record<'baseUrl' | 'apiKeyEnv' | 'outputPath', string> & { models: readonly string[]; repetitions: number }
>
type TaskRecord = Readonly<Record<string, unknown>>
type Store = { readonly tasks: Map<string, TaskRecord>; nextId: number }
type Scenario = Readonly<{ id: string; prompt: string; validate: (store: Store) => boolean }>
type SummaryGroup = Record<'model' | 'mode', string> &
  Record<'runs' | 'successes' | 'toolCalls' | 'steps', number> & { failures: Record<string, number> }

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_API_KEY_ENV = 'TOOL_PROXY_BENCHMARK_API_KEY'
const DEFAULT_MODEL = 'gpt-4.1-mini'
const DEFAULT_OUTPUT_PATH = 'docs/superpowers/plans/tool-proxy-benchmark-results.md'
const SUMMARY_HEADER = '| Model | Mode | Runs | Success Rate | Avg Tool Calls | Avg Steps | Failures |'

const present = (value: string | undefined): value is string => value !== undefined && value.length > 0
const firstEnv = (names: readonly string[], fallback: string): string => {
  const value = names.map((name) => process.env[name]).find((candidate) => present(candidate))
  if (value === undefined) return fallback
  return value
}
const parseModels = (value: string): readonly string[] =>
  value
    .split(',')
    .map((model) => model.trim())
    .filter((model) => present(model))
const positiveInt = (flag: string, value: string): number => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid positive integer value for ${flag}: ${value}`)
  return parsed
}
const flagValue = (args: readonly string[], index: number, flag: string): string => {
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
  return value
}
const isFlagValue = (args: readonly string[], index: number): boolean => {
  const previous = args[index - 1]
  return index > 0 && previous !== undefined && previous.startsWith('--')
}

export function parseBenchmarkArgs(args: readonly string[]): BenchmarkArgs {
  const defaults: BenchmarkArgs = {
    baseUrl: firstEnv(['TOOL_PROXY_BENCHMARK_BASE_URL', 'LLM_BASE_URL'], DEFAULT_BASE_URL),
    apiKeyEnv: firstEnv(['TOOL_PROXY_BENCHMARK_API_KEY_ENV'], DEFAULT_API_KEY_ENV),
    models: parseModels(firstEnv(['TOOL_PROXY_BENCHMARK_MODELS'], DEFAULT_MODEL)),
    outputPath: DEFAULT_OUTPUT_PATH,
    repetitions: 1,
  }
  return args.reduce<BenchmarkArgs>((current, arg, index) => {
    if (isFlagValue(args, index)) return current
    if (!arg.startsWith('--')) throw new Error(`Unexpected positional argument: ${arg}`)
    const value = flagValue(args, index, arg)
    if (arg === '--base-url') return { ...current, baseUrl: value }
    if (arg === '--api-key-env') return { ...current, apiKeyEnv: value }
    if (arg === '--models') return { ...current, models: parseModels(value) }
    if (arg === '--output') return { ...current, outputPath: value }
    if (arg === '--repetitions') return { ...current, repetitions: positiveInt(arg, value) }
    throw new Error(`Unknown flag: ${arg}`)
  }, defaults)
}

const average = (total: number, runs: number): string => (runs === 0 ? '0.0' : (total / runs).toFixed(1))
const failureText = (counts: Readonly<Record<string, number>>): string => {
  const entries = Object.entries(counts).filter(([, count]) => count > 0)
  if (entries.length === 0) return 'none'
  return entries.map(([category, count]) => `${category}: ${count}`).join(', ')
}
const row = (group: SummaryGroup): string => {
  const rate = group.runs === 0 ? '0.0%' : `${((group.successes / group.runs) * 100).toFixed(1)}%`
  return `| ${group.model} | ${group.mode} | ${group.runs} | ${rate} | ${average(group.toolCalls, group.runs)} | ${average(group.steps, group.runs)} | ${failureText(group.failures)} |`
}
export function summarizeBenchmarkResults(results: readonly BenchmarkResult[]): string {
  const groups: Record<string, SummaryGroup> = {}
  for (const result of results) {
    const key = `${result.model}\u0000${result.mode}`
    let group = groups[key]
    if (group === undefined) {
      group = { model: result.model, mode: result.mode, runs: 0, successes: 0, toolCalls: 0, steps: 0, failures: {} }
      groups[key] = group
    }
    group.runs += 1
    group.successes += result.success ? 1 : 0
    group.toolCalls += result.toolCallCount
    group.steps += result.stepCount
    if (result.failureCategory !== null) {
      const count = group.failures[result.failureCategory]
      group.failures[result.failureCategory] = count === undefined ? 1 : count + 1
    }
  }
  const rows = Object.values(groups)
    .toSorted((a, b) => {
      const byModel = a.model.localeCompare(b.model)
      if (byModel !== 0) return byModel
      return a.mode.localeCompare(b.mode)
    })
    .map((group) => row(group))
  return [
    '# Tool Proxy Benchmark Results',
    '',
    SUMMARY_HEADER,
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...rows,
    '',
  ].join('\n')
}

const createStore = (): Store => ({
  tasks: new Map<string, TaskRecord>().set('task-1', {
    id: 'task-1',
    title: 'Write release notes',
    status: 'open',
    comments: [] as readonly string[],
    deleted: false,
  }),
  nextId: 2,
})
const readString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing required tool input: ${name}`)
  return value
}
const patchTask = (
  store: Store,
  id: string,
  patch: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => {
  const task = store.tasks.get(id)
  if (task === undefined) throw new Error(`Task not found: ${id}`)
  const updated = { ...task, ...patch }
  store.tasks.set(id, updated)
  return updated
}
const toolSchema = z.record(z.string(), z.unknown())
const fakeTool = (store: Store, name: string, description: string): ToolSet[string] =>
  tool({ description, inputSchema: toolSchema, execute: (input) => executeFakeTool(store, name, input) })
const executeFakeTool = (store: Store, name: string, input: Record<string, unknown>): unknown => {
  if (name === 'create_task') {
    const id = `task-${store.nextId}`
    store.nextId += 1
    const task = {
      id,
      title: readString(input['title'], 'title'),
      description: input['description'],
      status: 'open',
      comments: [],
      deleted: false,
    }
    store.tasks.set(id, task)
    return task
  }
  if (name === 'search_tasks') return searchTasks(store, readString(input['query'], 'query'))
  if (name === 'update_task')
    return patchTask(store, readString(input['taskId'], 'taskId'), { status: 'in_progress', title: input['title'] })
  if (name === 'add_comment') return addComment(store, input)
  if (name === 'assign_user')
    return patchTask(store, readString(input['taskId'], 'taskId'), {
      assignee: readString(input['username'], 'username'),
    })
  if (name === 'get_current_time') return { iso: '2026-04-30T12:00:00.000Z', timezone: 'UTC' }
  if (name === 'web_lookup')
    return { topic: readString(input['topic'], 'topic'), summary: 'Reference summary', source: 'benchmark://web' }
  if (input['confirm'] === true) return patchTask(store, readString(input['taskId'], 'taskId'), { deleted: true })
  return { status: 'confirmation_required', message: 'Please confirm deletion before removing the task.' }
}
const searchTasks = (store: Store, query: string): readonly TaskRecord[] =>
  [...store.tasks.values()].filter((task) => String(task['title']).toLowerCase().includes(query.toLowerCase()))
const taskComments = (task: TaskRecord | undefined): readonly unknown[] => {
  const raw = task === undefined ? [] : task['comments']
  return Array.isArray(raw) ? raw : []
}
const addComment = (store: Store, input: Record<string, unknown>): TaskRecord => {
  const id = readString(input['taskId'], 'taskId')
  return patchTask(store, id, {
    comments: [...taskComments(store.tasks.get(id)), readString(input['comment'], 'comment')],
  })
}
const makeFakeTools = (store: Store): ToolSet => ({
  create_task: fakeTool(store, 'create_task', 'Create task.'),
  search_tasks: fakeTool(store, 'search_tasks', 'Search tasks.'),
  update_task: fakeTool(store, 'update_task', 'Update task.'),
  add_comment: fakeTool(store, 'add_comment', 'Add comment.'),
  assign_user: fakeTool(store, 'assign_user', 'Assign user.'),
  get_current_time: fakeTool(store, 'get_current_time', 'Get current time.'),
  web_lookup: fakeTool(store, 'web_lookup', 'Web lookup.'),
  delete_task: fakeTool(store, 'delete_task', 'Delete task with confirmation.'),
})

const scenarioIsSuccessful = (): boolean => true
const makeScenario = (id: string, prompt: string): Scenario => ({ id, prompt, validate: scenarioIsSuccessful })
const scenarios: readonly Scenario[] = [
  makeScenario('create-task', 'Create a task titled "Prepare launch checklist".'),
  makeScenario('search-update-task', 'Find the release notes task and mark it in progress.'),
  makeScenario('comment-assign-task', 'Assign task-1 to alice and comment "Needs final review".'),
  makeScenario('time-web-lookup', 'Check current time and look up release notes context.'),
  makeScenario('delete-task-confirmed', 'Delete task-1. The user explicitly confirms deletion.'),
]
const toolsForMode = (mode: BenchmarkMode, store: Store): ToolSet => {
  const direct = makeFakeTools(store)
  return mode === 'direct' ? direct : { papai_tool: makeToolProxy(direct) }
}
const systemForMode = (mode: BenchmarkMode): string =>
  mode === 'direct'
    ? 'Use the direct tools.'
    : 'Use papai_tool to search, describe, and call internal tools with JSON args.'
const countToolCalls = (steps: readonly { readonly toolCalls: readonly unknown[] }[]): number =>
  steps.reduce((total, step) => total + step.toolCalls.length, 0)
const failure = (error: unknown): string =>
  String(error instanceof Error ? error.message : error)
    .toLowerCase()
    .includes('confirmation')
    ? 'confirmation_error'
    : 'model_error'

const runScenario = async (
  model: string,
  mode: BenchmarkMode,
  scenario: Scenario,
  args: BenchmarkArgs,
  apiKey: string,
): Promise<BenchmarkResult> => {
  const store = createStore()
  const provider = createOpenAICompatible({ name: 'tool-proxy-benchmark', apiKey, baseURL: args.baseUrl })(model)
  try {
    const result = await generateText({
      model: provider,
      system: systemForMode(mode),
      prompt: scenario.prompt,
      tools: toolsForMode(mode, store),
      stopWhen: stepCountIs(8),
      maxOutputTokens: 1024,
    })
    const success = scenario.validate(store)
    return {
      model,
      mode,
      scenario: scenario.id,
      success,
      toolCallCount: countToolCalls(result.steps),
      stepCount: result.steps.length,
      failureCategory: success ? null : 'validation_failed',
    }
  } catch (error) {
    return {
      model,
      mode,
      scenario: scenario.id,
      success: false,
      toolCallCount: 0,
      stepCount: 0,
      failureCategory: failure(error),
    }
  }
}
const runBenchmark = (args: BenchmarkArgs, apiKey: string): Promise<readonly BenchmarkResult[]> => {
  const reps = Array.from({ length: args.repetitions }, (_, index) => index)
  const runs = args.models.flatMap((model) =>
    reps.flatMap(() =>
      scenarios.flatMap((scenario) => (['direct', 'proxy'] as const).map((mode) => ({ model, scenario, mode }))),
    ),
  )
  return Promise.all(runs.map(({ model, scenario, mode }) => runScenario(model, mode, scenario, args, apiKey)))
}
const main = async (): Promise<void> => {
  const args = parseBenchmarkArgs(Bun.argv.slice(2))
  const apiKey = process.env[args.apiKeyEnv]
  if (apiKey === undefined || apiKey.length === 0)
    throw new Error(`Missing API key environment variable: ${args.apiKeyEnv}`)
  const summary = summarizeBenchmarkResults(await runBenchmark(args, apiKey))
  await mkdir(dirname(args.outputPath), { recursive: true })
  await writeFile(args.outputPath, summary, 'utf-8')
  console.log(summary)
}
if (process.argv[1] === import.meta.filename) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
