import {
  filterClusters,
  findBestAgglomerativeMerge,
  findBestAgglomerativeMergeWithGap,
  getLinkageSimilarity,
  mergeClusters,
} from './consolidate-keywords-advanced-clustering-helpers.js'
import type { AgglomerativeMerge, Cluster } from './consolidate-keywords-advanced-clustering-helpers.js'
import {
  buildClustersNormalized,
  dotProduct,
  findWeakestInternalSimilarity,
  mapToGlobalClusters,
  toIndexedSubEmbeddings,
} from './consolidate-keywords-clustering.js'
import type { LinkageMode } from './consolidate-keywords-clustering.js'

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

function buildCandidatePairs(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
): readonly (readonly [number, number, number])[] {
  return normalizedEmbeddings
    .flatMap((embeddingI, i) =>
      normalizedEmbeddings.slice(i + 1).flatMap((embeddingJ, offset) => {
        const j = i + offset + 1
        const similarity = dotProduct(embeddingI, embeddingJ)
        return similarity >= threshold ? ([[i, j, similarity]] as const) : []
      }),
    )
    .toSorted((a, b) => b[2] - a[2])
}

function findClusterIndex(clusters: readonly Cluster[], item: number): number {
  return clusters.findIndex((cluster) => cluster.includes(item))
}

function findNextBestSimilarity(
  normalizedEmbeddings: readonly Float64Array[],
  item: number,
  clusterI: readonly number[],
  clusterJ: readonly number[],
): number {
  return normalizedEmbeddings.reduce((bestSimilarity, _, otherIndex) => {
    if (clusterI.includes(otherIndex) || clusterJ.includes(otherIndex)) return bestSimilarity
    return Math.max(bestSimilarity, dotProduct(normalizedEmbeddings[item]!, normalizedEmbeddings[otherIndex]!))
  }, Number.NEGATIVE_INFINITY)
}

function buildClustersSingleWithGap(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
  gapThreshold: number,
): readonly Cluster[] {
  let clusters: readonly Cluster[] = normalizedEmbeddings.map((_, index) => [index])

  for (const [itemI, itemJ, similarity] of buildCandidatePairs(normalizedEmbeddings, threshold)) {
    const clusterIndexI = findClusterIndex(clusters, itemI)
    const clusterIndexJ = findClusterIndex(clusters, itemJ)
    if (clusterIndexI < 0 || clusterIndexJ < 0 || clusterIndexI === clusterIndexJ) continue

    const clusterI = clusters[clusterIndexI]
    const clusterJ = clusters[clusterIndexJ]
    if (clusterI === undefined || clusterJ === undefined) continue

    const gapI = similarity - findNextBestSimilarity(normalizedEmbeddings, itemI, clusterI, clusterJ)
    const gapJ = similarity - findNextBestSimilarity(normalizedEmbeddings, itemJ, clusterI, clusterJ)
    if (gapI < gapThreshold || gapJ < gapThreshold) continue

    clusters = mergeClusters(clusters, [clusterIndexI, clusterIndexJ])
  }

  return filterClusters(clusters, minClusterSize)
}

function buildClustersNonSingle(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
  linkage: Exclude<LinkageMode, 'single'>,
  gapThreshold: number,
): readonly Cluster[] {
  let clusters: readonly Cluster[] = normalizedEmbeddings.map((_, index) => [index])
  const linkageSimilarity = getLinkageSimilarity(linkage)
  const findBestMerge: (currentClusters: readonly Cluster[]) => AgglomerativeMerge =
    gapThreshold > 0
      ? (currentClusters: readonly Cluster[]) =>
          findBestAgglomerativeMergeWithGap(
            currentClusters,
            threshold,
            linkageSimilarity,
            normalizedEmbeddings,
            gapThreshold,
          )
      : (currentClusters: readonly Cluster[]) =>
          findBestAgglomerativeMerge(currentClusters, threshold, linkageSimilarity, normalizedEmbeddings)

  for (;;) {
    const bestMerge = findBestMerge(clusters)
    if (bestMerge === undefined) return filterClusters(clusters, minClusterSize)
    clusters = mergeClusters(clusters, bestMerge.pair)
  }
}

export function buildClustersAdvanced(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
  linkage: LinkageMode,
  gapThreshold: number,
): readonly Cluster[] {
  if (gapThreshold <= 0) {
    return linkage === 'single'
      ? buildClustersNormalized(normalizedEmbeddings, threshold, minClusterSize)
      : buildClustersNonSingle(normalizedEmbeddings, threshold, minClusterSize, linkage, 0)
  }
  if (normalizedEmbeddings.length === 0) return []
  if (linkage === 'single') {
    return buildClustersSingleWithGap(normalizedEmbeddings, threshold, minClusterSize, gapThreshold)
  }
  return buildClustersNonSingle(normalizedEmbeddings, threshold, minClusterSize, linkage, gapThreshold)
}

function splitGlobalClusters(
  normalizedEmbeddings: readonly Float64Array[],
  globalClusters: readonly Cluster[],
  maxClusterSize: number,
  linkage: LinkageMode,
  thresholdStep: number,
  gapThreshold: number,
): readonly Cluster[] {
  return globalClusters.flatMap((globalCluster) =>
    globalCluster.length > maxClusterSize
      ? reclusterOversizedCluster(
          normalizedEmbeddings,
          globalCluster,
          maxClusterSize,
          linkage,
          thresholdStep,
          gapThreshold,
        )
      : [globalCluster],
  )
}

function reclusterOversizedCluster(
  normalizedEmbeddings: readonly Float64Array[],
  cluster: readonly number[],
  maxClusterSize: number,
  linkage: LinkageMode,
  thresholdStep: number,
  gapThreshold: number,
): readonly Cluster[] {
  const weakestSimilarity = findWeakestInternalSimilarity(normalizedEmbeddings, cluster)
  let baseThreshold = 1
  if (weakestSimilarity !== undefined) {
    baseThreshold = weakestSimilarity
  }
  const startingThreshold = Math.min(Math.max(baseThreshold + thresholdStep, 0), 1)
  const indexedSubEmbeddings = toIndexedSubEmbeddings(normalizedEmbeddings, cluster)
  if (indexedSubEmbeddings.length <= 1) return [cluster]

  const subEmbeddings = indexedSubEmbeddings.map(({ embedding }) => embedding)
  for (let threshold = startingThreshold; threshold <= 1; threshold = Math.min(threshold + thresholdStep, 1)) {
    const localClusters = buildClustersAdvanced(subEmbeddings, threshold, 1, linkage, gapThreshold)
    if (localClusters.length <= 1 && threshold < 1) continue

    const globalClusters = mapToGlobalClusters(indexedSubEmbeddings, localClusters)
    if (globalClusters.length <= 1) return [cluster]
    return splitGlobalClusters(
      normalizedEmbeddings,
      globalClusters,
      maxClusterSize,
      linkage,
      thresholdStep,
      gapThreshold,
    )
  }
  return [cluster]
}

export function subdivideOversizedClusters(
  normalizedEmbeddings: readonly Float64Array[],
  clusters: readonly Cluster[],
  maxClusterSize: number,
  linkage: LinkageMode,
  thresholdStep: number,
  gapThreshold: number,
): readonly Cluster[] {
  if (maxClusterSize <= 0 || thresholdStep <= 0) {
    return clusters.map((cluster) => [...cluster])
  }
  return clusters.flatMap((cluster) =>
    cluster.length > maxClusterSize
      ? reclusterOversizedCluster(normalizedEmbeddings, cluster, maxClusterSize, linkage, thresholdStep, gapThreshold)
      : [[...cluster]],
  )
}
