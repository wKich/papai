<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks — afk-runner-walk-robustness

- [ ] 1.1 Red-first F-P3: extend `tests/afk-runner/work/implement.test.ts` —
      a missing/unreadable tasks.md makes `runImplementWork` reject with
      `StageHaltError` carrying kind `precondition` and a restoration resume
      hint (not a plain `Error`). Watch it fail. → `bun test tests/afk-runner/work/implement.test.ts`
- [ ] 1.2 Red-first F-U3: extend `tests/afk-runner/work/run-check.test.ts` —
      the production check runner enforces a compiled wall cap on its spawn
      and a timed-out check returns non-zero exit with the cap-naming marker
      line in stderr. Watch it fail. → `bun test tests/afk-runner/work/run-check.test.ts`
- [ ] 1.3 Red-first F-P4: extend `tests/opencode-tdd-enforcement.test.ts` —
      per new check module: reset/rm/switch/checkout/branch-creation shapes
      refused naming the verb; flagged `git branch` forms allowed (mock-and-ctx
      pattern of the existing two checks). Watch it fail. → `bun test tests/opencode-tdd-enforcement.test.ts`
- [ ] 2.1 Implement F-P3: the read-catch in `runImplementWork`
      (`afk-runner/src/work/implement.ts`) throws the mirrored
      `StageHaltError('implement cannot read …', 'resume after the change
      folder is restored', 'precondition')` per design D1. → `bun test tests/afk-runner/work/implement.test.ts`
- [ ] 2.2 Implement F-U3: `EXEC_CHECK_WALL_CAP_MS` (30 min) + spawn timeout +
      marker in `afk-runner/src/work/run-check.ts` per design D2. → `bun test tests/afk-runner/work/run-check.test.ts`
- [ ] 2.3 Implement F-P4: new `.hooks/git/checks/block-git-*.mjs` siblings +
      `pre-bash.mjs` registry entries per design D3. → `bun test tests/opencode-tdd-enforcement.test.ts`
- [ ] 3.1 Sweep: `bun run test:affected` (covers afk-runner lanes; re-run the
      hook test file explicitly — the static-import heuristic cannot see the
      `.hooks/**` mock seams).
- [ ] 4.1 Docs: `docs/architecture/afk-runner.md` execution section
      (precondition halt + wall-capped checks), `docs/architecture/commands.md`
      write-protections line (widened verb list). → `bun run format:check`
- [ ] 5.1 Final gates: full `bun run test --serial`, `bun run lint`,
      `bun run typecheck`, `openspec validate afk-runner-walk-robustness --strict`.
