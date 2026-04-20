import type { ConsolidatedManifest, IncrementalManifest, IncrementalSelection } from './incremental.js'

export interface SelectIncrementalWorkInput {
  readonly changedFiles: readonly string[]
  readonly previousManifest: IncrementalManifest
  readonly currentPhaseVersions: IncrementalManifest['phaseVersions']
  readonly discoveredTestKeys: readonly string[]
  readonly previousConsolidatedManifest: ConsolidatedManifest | null
}

function toSortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].toSorted()
}

function computePhase1And2Keys(
  input: SelectIncrementalWorkInput,
  discoveredSet: ReadonlySet<string>,
  changedFilesSet: ReadonlySet<string>,
  previousPhaseVersions: IncrementalManifest['phaseVersions'],
): {
  readonly phase1Keys: readonly string[]
  readonly phase2Keys: readonly string[]
  readonly phase2VersionChanged: boolean
} {
  const entries = Object.entries(input.previousManifest.tests).filter(([k]) => discoveredSet.has(k))
  const depKeys = entries.filter(([, e]) => e.dependencyPaths.some((p) => changedFilesSet.has(p))).map(([k]) => k)
  const newKeys = input.discoveredTestKeys.filter((k) => input.previousManifest.tests[k] === undefined)
  const phase1Keys = toSortedUnique([...depKeys, ...newKeys])
  const phase2VersionChanged = previousPhaseVersions.phase2 !== input.currentPhaseVersions.phase2
  const phase2VersionKeys = phase2VersionChanged
    ? entries.filter(([, e]) => e.extractedBehaviorPath !== null).map(([k]) => k)
    : []
  return { phase1Keys, phase2Keys: toSortedUnique([...phase1Keys, ...phase2VersionKeys]), phase2VersionChanged }
}

function computePhase3Ids(
  phase1Keys: readonly string[],
  phase2Changed: boolean,
  manifest: ConsolidatedManifest | null,
): readonly string[] {
  const ids: string[] = []
  if (phase1Keys.length > 0 && manifest !== null) {
    const phase1Set = new Set(phase1Keys)
    for (const [id, entry] of Object.entries(manifest.entries)) {
      if (entry.sourceTestKeys.some((k) => phase1Set.has(k))) ids.push(id)
    }
  }
  if (phase2Changed && manifest !== null) {
    for (const [id] of Object.entries(manifest.entries)) {
      if (!ids.includes(id)) ids.push(id)
    }
  }
  return ids
}

export function selectIncrementalWork(input: SelectIncrementalWorkInput): IncrementalSelection {
  const discoveredSet = new Set(input.discoveredTestKeys)
  const changedFilesSet = new Set(input.changedFiles)
  const previousPhaseVersions = input.previousManifest.phaseVersions
  const phase1VersionChanged = previousPhaseVersions.phase1 !== input.currentPhaseVersions.phase1
  if (phase1VersionChanged) {
    const all = toSortedUnique(input.discoveredTestKeys)
    return {
      phase1SelectedTestKeys: all,
      phase2SelectedTestKeys: all,
      phase3SelectedConsolidatedIds: [],
      reportRebuildOnly: false,
    }
  }
  const { phase1Keys, phase2Keys, phase2VersionChanged } = computePhase1And2Keys(
    input,
    discoveredSet,
    changedFilesSet,
    previousPhaseVersions,
  )
  const phase3SelectedConsolidatedIds = computePhase3Ids(
    phase1Keys,
    phase2VersionChanged,
    input.previousConsolidatedManifest,
  )
  const reportVersionChanged = previousPhaseVersions.reports !== input.currentPhaseVersions.reports
  return {
    phase1SelectedTestKeys: phase1Keys,
    phase2SelectedTestKeys: phase2Keys,
    phase3SelectedConsolidatedIds,
    reportRebuildOnly:
      reportVersionChanged &&
      phase1Keys.length === 0 &&
      phase2Keys.length === 0 &&
      phase3SelectedConsolidatedIds.length === 0,
  }
}
