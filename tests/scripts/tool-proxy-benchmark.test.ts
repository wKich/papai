import { describe, expect, it } from 'bun:test'

import { parseBenchmarkArgs, summarizeBenchmarkResults } from '../../scripts/tool-proxy-benchmark.js'

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
})
