import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { runCli } from '../../scripts/review-loop/cli.js'

async function initGitRepo(cwd: string): Promise<void> {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
  const run = async (args: string[]): Promise<void> => {
    const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`git ${args.join(' ')} failed: ${stderr}`)
    }
  }
  await run(['init', '-q', '-b', 'main'])
  await run(['config', 'user.email', 'test@example.com'])
  await run(['config', 'user.name', 'Test'])
  await run(['config', 'commit.gpgsign', 'false'])
  await run(['config', 'gpg.format', 'openpgp'])
  await run(['commit', '--allow-empty', '-q', '-m', 'init'])
}

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('review-loop fake integration', () => {
  test('writes summary, transcript, and session files for a clean fake-agent run', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'review-loop-integration-'))
    tempDirs.push(dir)

    const reviewerScenarioPath = path.join(dir, 'reviewer.json')
    const fixerScenarioPath = path.join(dir, 'fixer.json')
    const configPath = path.join(dir, 'config.json')
    const planPath = path.join(dir, 'plan.md')

    writeFileSync(planPath, '# Implementation plan\n')
    writeFileSync(
      reviewerScenarioPath,
      JSON.stringify(
        {
          availableCommands: [{ name: 'review-code', description: 'Review code' }],
          promptReplies: [
            {
              text: '{"round":1,"issues":[{"title":"Race condition in queue flush path","severity":"high","summary":"Two concurrent messages can bypass the intended lock.","whyItMatters":"This can produce stale assistant replies.","evidence":"src/message-queue/queue.ts lines 84-107","file":"src/message-queue/queue.ts","lineStart":84,"lineEnd":107,"suggestedFix":"Take the processing lock earlier.","confidence":0.92}]}',
            },
            { text: '{"round":2,"issues":[]}' },
          ],
        },
        null,
        2,
      ),
    )
    writeFileSync(
      fixerScenarioPath,
      JSON.stringify(
        {
          availableCommands: [
            { name: 'verify-issue', description: 'Verify issue' },
            { name: 'fix-issue', description: 'Fix issue' },
          ],
          promptReplies: [
            {
              text: '{"verdict":"valid","fixability":"auto","reasoning":"The control flow is actually unsafe.","targetFiles":["src/message-queue/queue.ts"],"fixPlan":"Take the lock before the flush branch."}',
            },
            { text: 'Applied fix.' },
            {
              text: '{"whatChanged":"Moved the lock earlier in the flush path.","whyChanged":"Prevents the identified race condition."}',
            },
          ],
        },
        null,
        2,
      ),
    )

    const fakeRepo = path.join(dir, 'repo')
    mkdirSync(fakeRepo, { recursive: true })
    await initGitRepo(fakeRepo)
    const fakeAgentPath = path.resolve(process.cwd(), 'tests/review-loop/fake-agent.ts')
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          repoRoot: fakeRepo,
          workDir: path.join(dir, '.review-loop'),
          maxRounds: 5,
          maxNoProgressRounds: 2,
          reviewer: {
            command: 'bun',
            args: [fakeAgentPath],
            env: { ACP_SCENARIO_FILE: reviewerScenarioPath },
            sessionConfig: {},
            invocationPrefix: '/review-code',
            requireInvocationPrefix: true,
          },
          fixer: {
            command: 'bun',
            args: [fakeAgentPath],
            env: { ACP_SCENARIO_FILE: fixerScenarioPath },
            sessionConfig: {},
            verifyInvocationPrefix: '/verify-issue',
            fixInvocationPrefix: '/fix-issue',
            requireVerifyInvocation: true,
          },
        },
        null,
        2,
      ),
    )

    await runCli(['--config', configPath, '--plan', planPath])

    const runRoot = path.join(dir, '.review-loop', 'runs')
    const runId = readdirSync(runRoot)[0]
    if (runId === undefined) {
      throw new Error('Expected a fake run directory')
    }
    const summary = readFileSync(path.join(runRoot, runId, 'summary.txt'), 'utf8')
    const reviewerTranscript = readFileSync(path.join(runRoot, runId, 'transcripts', 'reviewer.ndjson'), 'utf8')
    const fixerTranscript = readFileSync(path.join(runRoot, runId, 'transcripts', 'fixer.ndjson'), 'utf8')
    const reviewerSession = readFileSync(path.join(runRoot, runId, 'reviewer-session.json'), 'utf8')

    expect(summary).toContain('Done reason: clean')
    expect(summary).toContain('Recorded fix changes: 1')
    expect(reviewerTranscript).toContain('"sessionUpdate":"agent_message_chunk"')
    expect(reviewerTranscript).toContain(
      '/review-code Review the current implementation against the implementation plan at:',
    )
    expect(reviewerTranscript).toContain(
      '/review-code Re-review the current implementation against the implementation plan at:',
    )
    expect(fixerTranscript).toContain('/verify-issue Verify this issue against the implementation plan at:')
    expect(fixerTranscript).toContain('/fix-issue Fix exactly the verified issue below.')
    expect(fixerTranscript).toContain('/fix-issue Describe the code changes just made to fix the issue below.')
    expect(reviewerSession).toContain('"sessionId"')

    const ledgerRaw = readFileSync(path.join(runRoot, runId, 'ledger.json'), 'utf8')
    expect(ledgerRaw).toContain('Moved the lock earlier in the flush path.')
    expect(ledgerRaw).toContain('Prevents the identified race condition.')

    const humanReviewRaw = readFileSync(path.join(runRoot, runId, 'human-review.json'), 'utf8')
    expect(JSON.parse(humanReviewRaw)).toEqual({ entries: [] })
  })
})
