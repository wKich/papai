import { dotProduct } from './consolidate-keywords-clustering.js'
import type { LinkageMode } from './consolidate-keywords-clustering.js'

type Cluster = readonly number[]
const DISTANCE_EPSILON = 1e-6

export type MutableDistanceMatrix = {
  readonly n: number
  readonly values: Float32Array
}

export type ActiveState = {
  readonly active: Uint8Array
  readonly sizes: Uint32Array
}

export function condensedIndex(i: number, j: number, n: number): number {
  const a = Math.min(i, j)
  const b = Math.max(i, j)
  return (a * (2 * n - a - 1)) / 2 + (b - a - 1)
}

export function getDistance(matrix: MutableDistanceMatrix, i: number, j: number): number {
  if (i === j) return 0
  const value = matrix.values[condensedIndex(i, j, matrix.n)]
  if (value === undefined) return Infinity
  return value
}

export function setDistance(matrix: MutableDistanceMatrix, i: number, j: number, distance: number): void {
  if (i === j) return
  matrix.values[condensedIndex(i, j, matrix.n)] = distance
}

export function buildCondensedDistanceMatrix(normalizedEmbeddings: readonly Float64Array[]): MutableDistanceMatrix {
  const n = normalizedEmbeddings.length
  const values = new Float32Array((n * (n - 1)) / 2)
  for (let i = 0; i < n; i++) {
    const embI = normalizedEmbeddings[i]
    if (embI === undefined) continue
    for (let j = i + 1; j < n; j++) {
      const embJ = normalizedEmbeddings[j]
      const similarity = embJ === undefined ? 0 : dotProduct(embI, embJ)
      values[condensedIndex(i, j, n)] = 1 - similarity
    }
  }
  return { n, values }
}

export function createActiveState(n: number): ActiveState {
  return {
    active: Uint8Array.from({ length: n }, () => 1),
    sizes: Uint32Array.from({ length: n }, () => 1),
  }
}

export function activeIndices(state: ActiveState): readonly number[] {
  return Array.from(state.active.entries()).flatMap(([index, marker]) => (marker === 1 ? [index] : []))
}

export function isActive(state: ActiveState, index: number): boolean {
  return state.active[index] === 1
}

function pairKey(a: number, b: number): string {
  return `${Math.min(a, b)}:${Math.max(a, b)}`
}

function compareNearest(a: { readonly distance: number; readonly candidate: number }, b: typeof a): number {
  const distanceOrder = a.distance - b.distance
  if (distanceOrder !== 0) return distanceOrder
  return a.candidate - b.candidate
}

function findNearestActiveCluster(
  matrix: MutableDistanceMatrix,
  state: ActiveState,
  cluster: number,
  blockedPairs: ReadonlySet<string>,
): number | undefined {
  const nearest = activeIndices(state)
    .filter((candidate) => candidate !== cluster)
    .filter((candidate) => !blockedPairs.has(pairKey(cluster, candidate)))
    .map((candidate) => ({ candidate, distance: getDistance(matrix, cluster, candidate) }))
    .toSorted(compareNearest)[0]
  if (nearest === undefined) return undefined
  return nearest.candidate
}

function updateMergedDistances(
  matrix: MutableDistanceMatrix,
  state: ActiveState,
  survivor: number,
  removed: number,
  linkage: Exclude<LinkageMode, 'single'>,
): void {
  const survivorSize = state.sizes[survivor]
  const removedSize = state.sizes[removed]
  if (survivorSize === undefined || removedSize === undefined) return
  for (const other of activeIndices(state)) {
    if (other === survivor || other === removed) continue
    const distanceToSurvivor = getDistance(matrix, survivor, other)
    const distanceToRemoved = getDistance(matrix, removed, other)
    const updatedDistance =
      linkage === 'average'
        ? (survivorSize * distanceToSurvivor + removedSize * distanceToRemoved) / (survivorSize + removedSize)
        : Math.max(distanceToSurvivor, distanceToRemoved)
    setDistance(matrix, survivor, other, updatedDistance)
  }
  state.sizes[survivor] = survivorSize + removedSize
  state.sizes[removed] = 0
  state.active[removed] = 0
}

function mergePassesGap(
  matrix: MutableDistanceMatrix,
  state: ActiveState,
  a: number,
  b: number,
  gapThreshold: number,
): boolean {
  if (gapThreshold <= 0) return true
  const candidateDistance = getDistance(matrix, a, b)
  const alternativeDistance = activeIndices(state).reduce((best, candidate) => {
    if (candidate === a || candidate === b) return best
    return Math.min(best, getDistance(matrix, a, candidate), getDistance(matrix, b, candidate))
  }, Infinity)
  if (alternativeDistance === Infinity) return true
  return alternativeDistance - candidateDistance + DISTANCE_EPSILON >= gapThreshold
}

function hasMergeCandidate(
  active: readonly number[],
  matrix: MutableDistanceMatrix,
  maxDistance: number,
  blockedPairs: ReadonlySet<string>,
): boolean {
  return active.some((a) =>
    active.some(
      (b) => a < b && getDistance(matrix, a, b) <= maxDistance + DISTANCE_EPSILON && !blockedPairs.has(pairKey(a, b)),
    ),
  )
}

function findChainStart(
  active: readonly number[],
  matrix: MutableDistanceMatrix,
  state: ActiveState,
  maxDistance: number,
  blockedPairs: ReadonlySet<string>,
): number | undefined {
  return active.find((cluster) => {
    const nearest = findNearestActiveCluster(matrix, state, cluster, blockedPairs)
    return nearest !== undefined && getDistance(matrix, cluster, nearest) <= maxDistance + DISTANCE_EPSILON
  })
}

function getClusterMembers(members: ReadonlyMap<number, Cluster>, id: number): Cluster {
  const cluster = members.get(id)
  if (cluster === undefined) return []
  return cluster
}

function tryExtendOrMergeChain(
  chain: number[],
  matrix: MutableDistanceMatrix,
  state: ActiveState,
  blockedPairs: ReadonlySet<string>,
  maxDistance: number,
):
  | { readonly kind: 'blocked' }
  | { readonly kind: 'extended' }
  | { readonly kind: 'merge'; readonly a: number; readonly b: number } {
  const current = chain.at(-1)
  if (current === undefined) return { kind: 'blocked' }
  const nearest = findNearestActiveCluster(matrix, state, current, blockedPairs)
  if (nearest === undefined || getDistance(matrix, current, nearest) > maxDistance + DISTANCE_EPSILON)
    return { kind: 'blocked' }
  if (chain.length > 1 && nearest === chain.at(-2)) {
    return { kind: 'merge', a: Math.min(current, nearest), b: Math.max(current, nearest) }
  }
  chain.push(nearest)
  return { kind: 'extended' }
}

function filterClusters(clusters: readonly Cluster[], minClusterSize: number): readonly Cluster[] {
  return clusters.filter((cluster) => cluster.length >= minClusterSize)
}

export function buildAgglomerativeClusters(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
  linkage: Exclude<LinkageMode, 'single'>,
  gapThreshold: number,
): readonly Cluster[] {
  const n = normalizedEmbeddings.length
  if (n === 0) return []
  const maxDistance = 1 - threshold
  const matrix = buildCondensedDistanceMatrix(normalizedEmbeddings)
  const state = createActiveState(n)
  const members = new Map<number, Cluster>(normalizedEmbeddings.map((_, index) => [index, [index]]))
  let blockedPairs = new Set<string>()

  for (;;) {
    const active = activeIndices(state)
    if (active.length <= 1) break
    const start = findChainStart(active, matrix, state, maxDistance, blockedPairs)
    if (start === undefined) break

    const chain: number[] = [start]
    let mergedThisRound = false
    for (;;) {
      const action = tryExtendOrMergeChain(chain, matrix, state, blockedPairs, maxDistance)
      if (action.kind === 'blocked') break
      if (action.kind === 'extended') continue
      if (!mergePassesGap(matrix, state, action.a, action.b, gapThreshold)) {
        blockedPairs = new Set([...blockedPairs, pairKey(action.a, action.b)])
        break
      }
      members.set(action.a, [...getClusterMembers(members, action.a), ...getClusterMembers(members, action.b)])
      members.delete(action.b)
      updateMergedDistances(matrix, state, action.a, action.b, linkage)
      blockedPairs = new Set<string>()
      mergedThisRound = true
      break
    }
    if (!mergedThisRound && !hasMergeCandidate(active, matrix, maxDistance, blockedPairs)) break
  }

  return filterClusters(
    [...members.entries()].filter(([id]) => isActive(state, id)).map(([, cluster]) => cluster),
    minClusterSize,
  )
}
