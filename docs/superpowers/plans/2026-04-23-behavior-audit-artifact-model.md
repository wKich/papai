# Behavior Audit Artifact Model Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `behavior-audit` artifacts so canonical data lives in structured JSON stores, `progress.json` is checkpoint-only, manifest files are index-only, and human-readable Markdown is derived output.

**Architecture:** Add dedicated extracted and evaluated stores, convert classified storage to per-test-file canonical JSON, and remove domain payloads from `progress.json`. Phase 2a and Phase 2b join canonical artifacts by `behaviorId`, while rerun logic relies on manifests and fingerprints instead of checkpoint payloads. Vocabulary becomes a unique canonical slug dictionary without `timesUsed`.

**Tech Stack:** TypeScript, Bun, Zod, JSON artifact stores, Bun test

---

### File Map

**New files:**

- `scripts/behavior-audit/extracted-store.ts` — extracted behavior canonical JSON store
- `scripts/behavior-audit/evaluated-store.ts` — evaluated feature canonical JSON store
- `scripts/behavior-audit/artifact-paths.ts` — path builders for extracted, classified, consolidated, evaluated, and derived report files

**Modified files:**

- `scripts/behavior-audit/config.ts` — add extracted and evaluated directory config
- `scripts/behavior-audit/progress.ts`
- `scripts/behavior-audit/progress-migrate.ts`
- `scripts/behavior-audit/incremental.ts`
- `scripts/behavior-audit/extract.ts`
- `scripts/behavior-audit/extract-phase1-helpers.ts`
- `scripts/behavior-audit/classify.ts`
- `scripts/behavior-audit/classified-store.ts`
- `scripts/behavior-audit/consolidate.ts`
- `scripts/behavior-audit/evaluate.ts`
- `scripts/behavior-audit/evaluate-reporting.ts`
- `scripts/behavior-audit/report-writer.ts`
- `scripts/behavior-audit/keyword-vocabulary.ts`
- `scripts/behavior-audit-reset.ts`
- `scripts/behavior-audit.ts`

**Primary tests to update or add:**

- `tests/scripts/behavior-audit-phase1-keywords.test.ts`
- `tests/scripts/behavior-audit-phase1-selection.test.ts`
- `tests/scripts/behavior-audit-phase2a.test.ts`
- `tests/scripts/behavior-audit-phase2b.test.ts`
- `tests/scripts/behavior-audit-phase3.test.ts`
- `tests/scripts/behavior-audit-incremental.test.ts`
- `tests/scripts/behavior-audit-storage.test.ts`
- `tests/scripts/behavior-audit-entrypoint.test.ts`

---

### Task 1: Add artifact path helpers and new canonical stores

**Files:**

- Create: `scripts/behavior-audit/artifact-paths.ts`
- Create: `scripts/behavior-audit/extracted-store.ts`
- Create: `scripts/behavior-audit/evaluated-store.ts`
- Modify: `scripts/behavior-audit/config.ts`
- Test: `tests/scripts/behavior-audit-storage.test.ts`

- [ ] **Step 1: Write failing storage tests for extracted and evaluated artifacts**

Add tests that expect:

- extracted records round-trip under `reports/audit-behavior/extracted/<domain>/<test-file>.json`
- evaluated records round-trip under `reports/audit-behavior/evaluated/<featureKey>.json`
- canonical stores return `null` for missing files and throw on malformed JSON

Run:

```bash
bun test tests/scripts/behavior-audit-storage.test.ts
```

Expected: FAIL because extracted and evaluated stores do not exist yet.

- [ ] **Step 2: Add path helper module**

Create `scripts/behavior-audit/artifact-paths.ts` with explicit builders:

```ts
import { join } from 'node:path'

import { BEHAVIORS_DIR, CLASSIFIED_DIR, CONSOLIDATED_DIR, EVALUATED_DIR, EXTRACTED_DIR } from './config.js'
import { getDomain } from './domain-map.js'

export function extractedArtifactPathForTestFile(testFilePath: string): string {
  const domain = getDomain(testFilePath)
  const fileName = testFilePath.split('/').pop()!.replace('.test.ts', '.test.json')
  return join(EXTRACTED_DIR, domain, fileName)
}

export function classifiedArtifactPathForTestFile(testFilePath: string): string {
  const domain = getDomain(testFilePath)
  const fileName = testFilePath.split('/').pop()!.replace('.test.ts', '.test.json')
  return join(CLASSIFIED_DIR, domain, fileName)
}

export function consolidatedArtifactPathForFeatureKey(featureKey: string): string {
  return join(CONSOLIDATED_DIR, `${featureKey}.json`)
}

export function evaluatedArtifactPathForFeatureKey(featureKey: string): string {
  return join(EVALUATED_DIR, `${featureKey}.json`)
}

export function behaviorMarkdownPathForTestFile(testFilePath: string): string {
  const domain = getDomain(testFilePath)
  const fileName = testFilePath.split('/').pop()!.replace('.test.ts', '.test.behaviors.md')
  return join(BEHAVIORS_DIR, domain, fileName)
}
```

- [ ] **Step 3: Add config entries for extracted and evaluated directories**

Update `scripts/behavior-audit/config.ts` to export:

```ts
export let EXTRACTED_DIR = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'extracted')
export let EVALUATED_DIR = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'evaluated')
```

and reload them from env overrides.

- [ ] **Step 4: Implement extracted and evaluated stores**

Create `scripts/behavior-audit/extracted-store.ts` with:

- `ExtractedBehaviorRecord` schema
- `writeExtractedFile(testFilePath, records)`
- `readExtractedFile(testFilePath)`

Create `scripts/behavior-audit/evaluated-store.ts` with:

- `EvaluatedFeatureRecord` schema
- `writeEvaluatedFile(featureKey, records)`
- `readEvaluatedFile(featureKey)`

- [ ] **Step 5: Run targeted storage tests**

Run:

```bash
bun test tests/scripts/behavior-audit-storage.test.ts
```

Expected: PASS for new extracted and evaluated store coverage.

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit/artifact-paths.ts scripts/behavior-audit/extracted-store.ts scripts/behavior-audit/evaluated-store.ts scripts/behavior-audit/config.ts tests/scripts/behavior-audit-storage.test.ts
git commit -m "refactor(behavior-audit): add canonical extracted and evaluated stores"
```

---

### Task 2: Convert progress.json into a checkpoint-only schema

**Files:**

- Modify: `scripts/behavior-audit/progress.ts`
- Modify: `scripts/behavior-audit/progress-migrate.ts`
- Test: `tests/scripts/behavior-audit-incremental.test.ts`
- Test: `tests/scripts/behavior-audit-storage.test.ts`

- [ ] **Step 1: Write failing tests for payload-free progress**

Add tests that expect:

- new empty progress does not contain `extractedBehaviors`, `classifiedBehaviors`, `consolidations`, or `evaluations`
- reset helpers clear status and failure maps without touching canonical artifacts
- legacy payload-heavy progress files are treated as incompatible and normalized to the new version

Run:

```bash
bun test tests/scripts/behavior-audit-incremental.test.ts tests/scripts/behavior-audit-storage.test.ts
```

Expected: FAIL because current schemas still expose payload maps.

- [ ] **Step 2: Update the progress types and helpers**

Modify `scripts/behavior-audit/progress.ts` so phase state keeps only:

- completion maps by ID
- failure maps
- stats
- status

Use these names:

```ts
completedTests
completedBehaviors
completedFeatureKeys
completedConsolidatedIds
```

Remove payload-bearing maps entirely.

- [ ] **Step 3: Update progress migration behavior**

Modify `scripts/behavior-audit/progress-migrate.ts` to:

- parse the new `version: 4` shape
- treat earlier payload-heavy versions as incompatible with a clean reset result
- preserve only safe counters or statuses if they still make sense

- [ ] **Step 4: Update reset behavior to the new progress schema**

Ensure `resetPhase2AndPhase3`, `resetPhase2bAndPhase3`, and `resetPhase3` only operate on checkpoint fields.

- [ ] **Step 5: Run focused tests**

Run:

```bash
bun test tests/scripts/behavior-audit-incremental.test.ts tests/scripts/behavior-audit-storage.test.ts
```

Expected: PASS for progress schema and reset behavior.

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit/progress.ts scripts/behavior-audit/progress-migrate.ts tests/scripts/behavior-audit-incremental.test.ts tests/scripts/behavior-audit-storage.test.ts
git commit -m "refactor(behavior-audit): make progress checkpoint-only"
```

---

### Task 3: Rework Phase 1 to write canonical extracted JSON and derived Markdown

**Files:**

- Modify: `scripts/behavior-audit/extract.ts`
- Modify: `scripts/behavior-audit/extract-phase1-helpers.ts`
- Modify: `scripts/behavior-audit/report-writer.ts`
- Modify: `scripts/behavior-audit/incremental.ts`
- Test: `tests/scripts/behavior-audit-phase1-keywords.test.ts`
- Test: `tests/scripts/behavior-audit-phase1-selection.test.ts`

- [ ] **Step 1: Write failing Phase 1 tests for canonical extracted storage**

Update tests to expect:

- Phase 1 writes extracted JSON artifacts
- Phase 1 behavior Markdown is regenerated from extracted JSON
- `progress.json` no longer stores extracted payloads
- `incremental-manifest.json` stores `extractedArtifactPath`

Run:

```bash
bun test tests/scripts/behavior-audit-phase1-keywords.test.ts tests/scripts/behavior-audit-phase1-selection.test.ts
```

Expected: FAIL because Phase 1 still stores payloads in progress and uses the old manifest field.

- [ ] **Step 2: Add extracted record conversion in Phase 1**

In `scripts/behavior-audit/extract.ts`, convert each extracted result into an `ExtractedBehaviorRecord` with:

```ts
const behaviorId = testKey
const record = {
  behaviorId,
  testKey,
  testFile: testFilePath,
  domain: getDomain(testFilePath),
  testName: testCase.name,
  fullPath: testCase.fullPath,
  behavior: extracted.behavior,
  context: extracted.context,
  keywords,
  extractedAt: new Date().toISOString(),
}
```

- [ ] **Step 3: Replace payload writes with extracted-store writes**

Update `extract-phase1-helpers.ts` to write the selected file’s extracted records through `writeExtractedFile()` and regenerate Markdown from those extracted records.

- [ ] **Step 4: Replace manifest fields**

In `scripts/behavior-audit/incremental.ts` and the Phase 1 update path, rename:

- `candidateFeatureKey` to `featureKey`
- `extractedBehaviorPath` to `extractedArtifactPath`

and add `classifiedArtifactPath` as a nullable manifest field.

- [ ] **Step 5: Keep startup invalidation safe**

Adjust `runPhase1()` so when selected Phase 1 work exists, downstream checkpoint phases are reset before the first `saveProgress(progress)` call.

- [ ] **Step 6: Run targeted Phase 1 tests**

Run:

```bash
bun test tests/scripts/behavior-audit-phase1-keywords.test.ts tests/scripts/behavior-audit-phase1-selection.test.ts
```

Expected: PASS with payload-free progress and extracted JSON canonical storage.

- [ ] **Step 7: Commit**

```bash
git add scripts/behavior-audit/extract.ts scripts/behavior-audit/extract-phase1-helpers.ts scripts/behavior-audit/report-writer.ts scripts/behavior-audit/incremental.ts tests/scripts/behavior-audit-phase1-keywords.test.ts tests/scripts/behavior-audit-phase1-selection.test.ts
git commit -m "refactor(behavior-audit): make extracted json canonical"
```

---

### Task 4: Rework Phase 2a around extracted artifacts and per-test-file classified artifacts

**Files:**

- Modify: `scripts/behavior-audit/classify.ts`
- Modify: `scripts/behavior-audit/classified-store.ts`
- Modify: `scripts/behavior-audit/incremental.ts`
- Test: `tests/scripts/behavior-audit-phase2a.test.ts`
- Test: `tests/scripts/behavior-audit-incremental.test.ts`

- [ ] **Step 1: Write failing tests for payload-free Phase 2a**

Update tests to expect:

- Phase 2a reads extracted JSON artifacts instead of `progress.phase1.extractedBehaviors`
- Phase 2a writes classification-only JSON artifacts per test file
- `featureKey` replaces `candidateFeatureKey`
- `progress.phase2a` no longer stores classification payloads

Run:

```bash
bun test tests/scripts/behavior-audit-phase2a.test.ts tests/scripts/behavior-audit-incremental.test.ts
```

Expected: FAIL because Phase 2a still depends on progress payloads.

- [ ] **Step 2: Change classified-store layout and schema**

Modify `scripts/behavior-audit/classified-store.ts` so:

- file path is per test file, not per domain aggregate
- schema uses `featureKey` and `featureLabel`
- classification records do not duplicate extracted `behavior`, `context`, or `keywords`

- [ ] **Step 3: Load extracted inputs from canonical extracted files**

In `scripts/behavior-audit/classify.ts`, replace `selectBehaviors(progress, selectedTestKeys)` with a loader that:

- walks manifest entries for selected tests
- reads `extractedArtifactPath`
- selects the right record by `behaviorId` or `testKey`

- [ ] **Step 4: Update manifest writes for Phase 2a**

Write these manifest fields on successful classification:

- `behaviorId`
- `featureKey`
- `classifiedArtifactPath`
- `phase2aFingerprint`
- `lastPhase2aCompletedAt`

- [ ] **Step 5: Save progress as checkpoint only**

Keep status, completed behavior IDs, failures, and stats. Do not persist `ClassifiedBehaviorRecord` payloads in progress.

- [ ] **Step 6: Run targeted Phase 2a tests**

Run:

```bash
bun test tests/scripts/behavior-audit-phase2a.test.ts tests/scripts/behavior-audit-incremental.test.ts
```

Expected: PASS with extracted-store-backed Phase 2a behavior.

- [ ] **Step 7: Commit**

```bash
git add scripts/behavior-audit/classify.ts scripts/behavior-audit/classified-store.ts scripts/behavior-audit/incremental.ts tests/scripts/behavior-audit-phase2a.test.ts tests/scripts/behavior-audit-incremental.test.ts
git commit -m "refactor(behavior-audit): make phase2a read extracted artifacts"
```

---

### Task 5: Rework Phase 2b and Phase 3 around canonical artifacts and manifests

**Files:**

- Modify: `scripts/behavior-audit/consolidate.ts`
- Modify: `scripts/behavior-audit/evaluate.ts`
- Modify: `scripts/behavior-audit/evaluate-reporting.ts`
- Modify: `scripts/behavior-audit/report-writer.ts`
- Modify: `scripts/behavior-audit/incremental.ts`
- Test: `tests/scripts/behavior-audit-phase2b.test.ts`
- Test: `tests/scripts/behavior-audit-phase3.test.ts`

- [ ] **Step 1: Write failing Phase 2b and Phase 3 tests**

Update tests to expect:

- Phase 2b joins classified and extracted artifacts by `behaviorId`
- Phase 2b writes consolidated JSON by `featureKey`
- Phase 3 writes evaluated JSON by `featureKey`
- story Markdown rebuilds by joining consolidated and evaluated artifacts
- `progress.json` stores no consolidations or evaluations

Run:

```bash
bun test tests/scripts/behavior-audit-phase2b.test.ts tests/scripts/behavior-audit-phase3.test.ts
```

Expected: FAIL because both phases still depend on progress payloads.

- [ ] **Step 2: Update Phase 2b input loading**

In `scripts/behavior-audit/consolidate.ts`, replace grouping from `progress.phase2a.classifiedBehaviors` with a load-and-join path:

- load all selected classified artifacts
- map by `behaviorId`
- join matching extracted records for `behavior`, `context`, and `keywords`
- group joined records by `featureKey`

- [ ] **Step 3: Update consolidated manifest schema**

Modify `scripts/behavior-audit/incremental.ts` so `ConsolidatedManifestEntry` stores:

- `featureKey`
- `consolidatedArtifactPath`
- `evaluatedArtifactPath`
- `phase3Fingerprint`
- `lastEvaluatedAt`

- [ ] **Step 4: Add evaluated artifact persistence in Phase 3**

In `scripts/behavior-audit/evaluate.ts`, persist evaluation results through `writeEvaluatedFile(featureKey, records)` and update consolidated-manifest evaluation fields.

- [ ] **Step 5: Rewrite report generation to use canonical artifacts**

In `scripts/behavior-audit/evaluate-reporting.ts` and `report-writer.ts`:

- join consolidated JSON with evaluated JSON for story Markdown
- rebuild index from evaluated results plus progress failure maps
- remove dependence on `progress.phase3.evaluations`

- [ ] **Step 6: Run targeted Phase 2b and Phase 3 tests**

Run:

```bash
bun test tests/scripts/behavior-audit-phase2b.test.ts tests/scripts/behavior-audit-phase3.test.ts
```

Expected: PASS with canonical consolidated and evaluated stores.

- [ ] **Step 7: Commit**

```bash
git add scripts/behavior-audit/consolidate.ts scripts/behavior-audit/evaluate.ts scripts/behavior-audit/evaluate-reporting.ts scripts/behavior-audit/report-writer.ts scripts/behavior-audit/incremental.ts tests/scripts/behavior-audit-phase2b.test.ts tests/scripts/behavior-audit-phase3.test.ts
git commit -m "refactor(behavior-audit): make phase2b and phase3 artifact-driven"
```

---

### Task 6: Normalize keyword vocabulary and remove timesUsed

**Files:**

- Modify: `scripts/behavior-audit/keyword-vocabulary.ts`
- Modify: `scripts/behavior-audit/extract.ts`
- Test: `tests/scripts/behavior-audit-phase1-keywords.test.ts`
- Test: `tests/scripts/behavior-audit-storage.test.ts`

- [ ] **Step 1: Write failing tests for unique vocabulary slugs and no timesUsed**

Update or add tests to expect:

- saved vocabulary entries do not contain `timesUsed`
- duplicate slug entries normalize into one canonical entry
- Phase 1 does not append a duplicate slug when the resolver returns an already-known slug

Run:

```bash
bun test tests/scripts/behavior-audit-phase1-keywords.test.ts tests/scripts/behavior-audit-storage.test.ts
```

Expected: FAIL because current vocabulary still stores `timesUsed` and allows duplicates.

- [ ] **Step 2: Remove timesUsed from the schema**

Change `KeywordVocabularyEntrySchema` to:

```ts
const KeywordVocabularyEntrySchema = z.object({
  slug: z.string(),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
```

- [ ] **Step 3: Add deterministic normalization by slug**

Implement a helper in `keyword-vocabulary.ts` that:

- groups entries by `slug`
- retains earliest `createdAt`
- retains latest `updatedAt`
- keeps description from the most recently updated entry
- sorts output by `slug`

- [ ] **Step 4: Update Phase 1 vocabulary writes**

In `extract.ts`, before saving the next vocabulary, merge appended entries into the normalized existing vocabulary instead of blindly concatenating arrays.

- [ ] **Step 5: Run vocabulary tests**

Run:

```bash
bun test tests/scripts/behavior-audit-phase1-keywords.test.ts tests/scripts/behavior-audit-storage.test.ts
```

Expected: PASS with unique vocabulary slugs and no `timesUsed` field.

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit/keyword-vocabulary.ts scripts/behavior-audit/extract.ts tests/scripts/behavior-audit-phase1-keywords.test.ts tests/scripts/behavior-audit-storage.test.ts
git commit -m "refactor(behavior-audit): normalize keyword vocabulary"
```

---

### Task 7: Rework entrypoint, rebuild-only mode, and reset flows

**Files:**

- Modify: `scripts/behavior-audit.ts`
- Modify: `scripts/behavior-audit-reset.ts`
- Test: `tests/scripts/behavior-audit-entrypoint.test.ts`
- Test: `tests/scripts/behavior-audit-storage.test.ts`

- [ ] **Step 1: Write failing tests for report rebuild-only mode and reset behavior**

Update tests to expect:

- rebuild-only mode loads extracted and evaluated canonical artifacts instead of progress payloads
- `resetBehaviorAudit('phase2')` removes classified, consolidated, evaluated, and story artifacts but preserves normalized vocabulary
- `resetBehaviorAudit('phase3')` removes evaluated and story artifacts only

Run:

```bash
bun test tests/scripts/behavior-audit-entrypoint.test.ts tests/scripts/behavior-audit-storage.test.ts
```

Expected: FAIL because current entrypoint rebuild path still reads from progress payloads.

- [ ] **Step 2: Update rebuild-only mode**

In `scripts/behavior-audit.ts`, replace:

```ts
extractedBehaviorsByKey: progress.phase1.extractedBehaviors,
evaluationsByKey: progress.phase3.evaluations,
```

with a canonical artifact loading path that scans:

- `incremental-manifest.json` for extracted artifact paths
- `consolidated-manifest.json` for consolidated and evaluated artifact paths

- [ ] **Step 3: Update reset behavior for new directories**

Modify `scripts/behavior-audit-reset.ts` so:

- phase2 reset removes `classified/`, `consolidated/`, `evaluated/`, and `stories/`
- phase3 reset removes `evaluated/` and `stories/`

- [ ] **Step 4: Run entrypoint and reset tests**

Run:

```bash
bun test tests/scripts/behavior-audit-entrypoint.test.ts tests/scripts/behavior-audit-storage.test.ts
```

Expected: PASS with artifact-driven rebuilds and resets.

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit.ts scripts/behavior-audit-reset.ts tests/scripts/behavior-audit-entrypoint.test.ts tests/scripts/behavior-audit-storage.test.ts
git commit -m "refactor(behavior-audit): rebuild reports from canonical artifacts"
```

---

### Task 8: Run full verification and clean up remaining test coupling

**Files:**

- Modify: any touched test files that still assume payload-heavy progress

- [ ] **Step 1: Run the full behavior-audit test slice**

Run:

```bash
bun test tests/scripts/behavior-audit-phase1-keywords.test.ts tests/scripts/behavior-audit-phase1-selection.test.ts tests/scripts/behavior-audit-phase2a.test.ts tests/scripts/behavior-audit-phase2b.test.ts tests/scripts/behavior-audit-phase3.test.ts tests/scripts/behavior-audit-incremental.test.ts tests/scripts/behavior-audit-storage.test.ts tests/scripts/behavior-audit-entrypoint.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repo verification commands**

Run:

```bash
bun test
bun typecheck
bun lint
```

Expected: PASS.

- [ ] **Step 3: Commit final cleanup**

```bash
git add scripts/behavior-audit tests/scripts docs/superpowers/specs/2026-04-23-behavior-audit-artifact-model-design.md docs/superpowers/plans/2026-04-23-behavior-audit-artifact-model.md
git commit -m "refactor(behavior-audit): clarify canonical artifacts and checkpoint state"
```

---

### Spec Coverage Check

- canonical JSON artifacts: covered by Tasks 1, 3, 4, and 5
- payload-free progress: covered by Task 2
- manifest-only indexing: covered by Tasks 3, 4, and 5
- startup stale state reset: covered by Task 3
- vocabulary uniqueness and `timesUsed` removal: covered by Task 6
- rebuild-only mode using canonical artifacts: covered by Task 7
- reset behavior under the new artifact tree: covered by Task 7

No gaps found.
