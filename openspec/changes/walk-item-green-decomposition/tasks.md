<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks — walk-item-green-decomposition

- [ ] 1.1 Red-first pin: extend `tests/afk-runner/work/decompose.test.ts` —
      `buildDecomposerPrompt` output states the red→green-cycle granularity
      contract (test+impl same task; never a test-only task; every task leaves
      the tree green for the executor's per-task affected check). Watch it
      fail. → `bun test tests/afk-runner/work/decompose.test.ts`
- [ ] 1.2 Red-first pin: extend `tests/afk-runner/work/atomicity.test.ts` —
      `buildAtomicityPrompt` output requires independently-green tasks, pairs
      tests with their implementations, and carries no sentence readable as
      licensing test-only items (assert the reworded verification line).
      Watch it fail. → `bun test tests/afk-runner/work/atomicity.test.ts`
- [ ] 2.1 Implement: add the granularity contract to
      `buildDecomposerPrompt` (`afk-runner/src/work/decompose.ts`) and reword
      `buildAtomicityPrompt` (`afk-runner/src/work/atomicity.ts`) per design
      D1; no other seam touched. → `bun test tests/afk-runner/work/decompose.test.ts tests/afk-runner/work/atomicity.test.ts`
- [ ] 3.1 Sweep the affected suites (the prompt builders feed the work-module
      suites). → `bun run test:affected`
- [ ] 4.1 Docs: one sentence each in `docs/architecture/afk-runner.md` (tail
      section: decompose/atomicity prompts carry the walk-granularity
      contract; execution section unchanged — the check side is the fixed
      point). → `bun run format:check`
- [ ] 5.1 Final gates: full `bun run test --serial`, `bun run lint`,
      `bun run typecheck`, `openspec validate walk-item-green-decomposition --strict`.
- [ ] 6.1 Live drill (owed verification, next armed cycle — design D5): an
      armed run on a red-first-prone task asserting zero operator re-targets
      through the walk; recorded in the change's notes before it archives.
