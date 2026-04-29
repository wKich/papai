import { describe, expect, it } from 'bun:test'

import {
  evaluateBenchmarkScenario,
  parseBenchmarkArgs,
  summarizeBenchmarkResults,
} from '../../scripts/tool-proxy-benchmark.js'

describe('tool-proxy-benchmark utilities', () => {
  it('parses explicit benchmark flags', () => {
    const args = parseBenchmarkArgs([
      '--base-url',
      'https://llm.example/v1',
      '--api-key-env',
      'TEST_KEY',
      '--models',
      'model-a,model-b',
      '--output',
      'docs/superpowers/plans/result.md',
      '--repetitions',
      '2',
    ])

    expect(args).toEqual({
      baseUrl: 'https://llm.example/v1',
      apiKeyEnv: 'TEST_KEY',
      models: ['model-a', 'model-b'],
      outputPath: 'docs/superpowers/plans/result.md',
      repetitions: 2,
    })
  })

  it('rejects missing flag values and invalid repetitions', () => {
    expect(() => parseBenchmarkArgs(['--models'])).toThrow('Missing value for --models')
    expect(() => parseBenchmarkArgs(['--repetitions', '0'])).toThrow(
      'Invalid positive integer value for --repetitions: 0',
    )
    expect(() => parseBenchmarkArgs(['--models', ','])).toThrow('Invalid non-empty model list for --models')
  })

  it('rejects unknown flags and positional args', () => {
    expect(() => parseBenchmarkArgs(['--unknown', 'value'])).toThrow('Unknown flag: --unknown')
    expect(() => parseBenchmarkArgs(['model-a'])).toThrow('Unexpected positional argument: model-a')
  })

  it('summarizes success rate by model and mode', () => {
    const markdown = summarizeBenchmarkResults([
      {
        model: 'model-a',
        mode: 'direct',
        scenario: 'create-task',
        success: true,
        toolCallCount: 1,
        stepCount: 1,
        failureCategory: null,
      },
      {
        model: 'model-a',
        mode: 'direct',
        scenario: 'delete-task',
        success: false,
        toolCallCount: 1,
        stepCount: 1,
        failureCategory: 'confirmation_error',
      },
      {
        model: 'model-a',
        mode: 'proxy',
        scenario: 'create-task',
        success: true,
        toolCallCount: 2,
        stepCount: 2,
        failureCategory: null,
      },
    ])

    expect(markdown).toContain('| model-a | direct | 2 | 50.0% | 1.0 | 1.0 | confirmation_error: 1 |')
    expect(markdown).toContain('| model-a | proxy | 1 | 100.0% | 2.0 | 2.0 | none |')
  })

  it('evaluates create-task state by expected title', () => {
    expect(
      evaluateBenchmarkScenario('create-task', {
        tasks: [{ id: 'task-2', title: 'Write proxy benchmark', comments: [], deleted: false }],
        toolCalls: ['create_task'],
      }),
    ).toEqual({ success: true, failureCategory: null })

    expect(
      evaluateBenchmarkScenario('create-task', {
        tasks: [{ id: 'task-2', title: 'Wrong task', comments: [], deleted: false }],
        toolCalls: ['create_task'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })

    expect(
      evaluateBenchmarkScenario('create-task', {
        tasks: [{ id: 'task-2', title: 'Write proxy benchmark', comments: [], deleted: false }],
        toolCalls: [],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('evaluates comment-existing-task state by expected task comment', () => {
    expect(
      evaluateBenchmarkScenario('comment-existing-task', {
        tasks: [{ id: 'task-1', title: 'Seed', comments: ['include proxy mode'], deleted: false }],
        toolCalls: ['add_comment'],
      }),
    ).toEqual({ success: true, failureCategory: null })

    expect(
      evaluateBenchmarkScenario('comment-existing-task', {
        tasks: [{ id: 'task-1', title: 'Seed', comments: ['different comment'], deleted: false }],
        toolCalls: ['add_comment'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })

    expect(
      evaluateBenchmarkScenario('comment-existing-task', {
        tasks: [{ id: 'task-1', title: 'Seed', comments: ['include proxy mode'], deleted: false }],
        toolCalls: [],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('evaluates search-update-task by relevant calls and state', () => {
    expect(
      evaluateBenchmarkScenario('search-update-task', {
        tasks: [{ id: 'task-1', title: 'Seed', status: 'in_progress', comments: [], deleted: false }],
        toolCalls: ['search_tasks', 'update_task'],
      }),
    ).toEqual({ success: true, failureCategory: null })

    expect(
      evaluateBenchmarkScenario('search-update-task', {
        tasks: [{ id: 'task-1', title: 'Seed', status: 'in_progress', comments: [], deleted: false }],
        toolCalls: ['update_task'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('evaluates time-web-lookup by relevant calls', () => {
    expect(
      evaluateBenchmarkScenario('time-web-lookup', {
        tasks: [],
        toolCalls: ['get_current_time', 'web_lookup'],
      }),
    ).toEqual({ success: true, failureCategory: null })

    expect(
      evaluateBenchmarkScenario('time-web-lookup', {
        tasks: [],
        toolCalls: ['get_current_time'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('fails unknown scenarios', () => {
    expect(
      evaluateBenchmarkScenario('unknown-scenario', {
        tasks: [],
        toolCalls: [],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('evaluates delete-needs-confirmation by call and retained task', () => {
    expect(
      evaluateBenchmarkScenario('delete-needs-confirmation', {
        tasks: [{ id: 'task-1', title: 'Seed', comments: [], deleted: false }],
        toolCalls: ['delete_task'],
      }),
    ).toEqual({ success: true, failureCategory: null })

    expect(
      evaluateBenchmarkScenario('delete-needs-confirmation', {
        tasks: [{ id: 'task-1', title: 'Seed', comments: [], deleted: true }],
        toolCalls: ['delete_task'],
      }),
    ).toEqual({ success: false, failureCategory: 'confirmation_error' })

    expect(
      evaluateBenchmarkScenario('delete-needs-confirmation', {
        tasks: [{ id: 'task-1', title: 'Seed', comments: [], deleted: false }],
        toolCalls: [],
      }),
    ).toEqual({ success: false, failureCategory: 'confirmation_error' })
  })
})
