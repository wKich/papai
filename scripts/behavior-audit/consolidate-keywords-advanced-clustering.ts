import {
  averageLinkageSimilarity,
  buildClustersNormalized,
  completeLinkageSimilarity,
  dotProduct,
} from './consolidate-keywords-clustering.js'
import type { LinkageMode } from './consolidate-keywords-clustering.js'

type Cluster = readonly number[]
type LinkageSimilarity = (
  embeddings: readonly Float64Array[],
  clusterA: readonly number[],
  clusterB: readonly number[],
) => number
type AgglomerativeMerge = { readonly pair: readonly [number, number]; readonly similarity: number } | undefined

function mergeClusters(clusters: readonly Cluster[], mergePair: readonly [number, number]): readonly Cluster[] {
  const [bestA, bestB] = mergePair
  const clusterA = clusters[bestA]
  const clusterB = clusters[bestB]
  if (clusterA === undefined || clusterB === undefined) return clusters
  return clusters.flatMap((cluster, index) => {
    if (index === bestA) {
      return [[...clusterA, ...clusterB]]
    }
    return index === bestB ? [] : [cluster]
  })
}

function filterClusters(clusters: readonly Cluster[], minClusterSize: number): readonly Cluster[] {
  return clusters.filter((cluster) => cluster.length >= minClusterSize)
}
function getLinkageSimilarity(linkage: Exclude<LinkageMode, 'single'>): LinkageSimilarity {
  return linkage === 'average' ? averageLinkageSimilarity : completeLinkageSimilarity
}

function findBestAgglomerativeMerge(
  clusters: readonly Cluster[],
  threshold: number,
  linkageSimilarity: LinkageSimilarity,
  normalizedEmbeddings: readonly Float64Array[],
): AgglomerativeMerge {
  let bestSimilarity = Number.NEGATIVE_INFINITY
  let bestPair: readonly [number, number] | undefined
  for (let i = 0; i < clusters.length; i++) {
    const clusterA = clusters[i]
    if (clusterA === undefined) continue
    for (let j = i + 1; j < clusters.length; j++) {
      const clusterB = clusters[j]
      if (clusterB === undefined) continue
      const similarity = linkageSimilarity(normalizedEmbeddings, clusterA, clusterB)
      if (similarity >= threshold && similarity > bestSimilarity) {
        bestSimilarity = similarity
        bestPair = [i, j]
      }
    }
  }
  return bestPair === undefined ? undefined : { pair: bestPair, similarity: bestSimilarity }
}

function findBestAgglomerativeMergeWithGap(
  clusters: readonly Cluster[],
  threshold: number,
  linkageSimilarity: LinkageSimilarity,
  normalizedEmbeddings: readonly Float64Array[],
  gapThreshold: number,
): AgglomerativeMerge {
  let bestSimilarity = Number.NEGATIVE_INFINITY
  let bestPair: readonly [number, number] | undefined
  for (let i = 0; i < clusters.length; i++) {
    const clusterA = clusters[i]
    if (clusterA === undefined) continue
    for (let j = i + 1; j < clusters.length; j++) {
      const clusterB = clusters[j]
      if (clusterB === undefined) continue
      const similarity = linkageSimilarity(normalizedEmbeddings, clusterA, clusterB)
      if (similarity < threshold || similarity <= bestSimilarity) continue

      const nextBestSimilarity = findBestAlternativeSimilarity(
        clusters,
        [i, j],
        linkageSimilarity,
        normalizedEmbeddings,
      )
      if (similarity - nextBestSimilarity < gapThreshold) continue

      bestSimilarity = similarity
      bestPair = [i, j]
    }
  }
  return bestPair === undefined ? undefined : { pair: bestPair, similarity: bestSimilarity }
}

function findBestAlternativeSimilarity(
  clusters: readonly Cluster[],
  mergePair: readonly [number, number],
  linkageSimilarity: LinkageSimilarity,
  normalizedEmbeddings: readonly Float64Array[],
): number {
  const clusterA = clusters[mergePair[0]]
  const clusterB = clusters[mergePair[1]]
  if (clusterA === undefined || clusterB === undefined) return Number.NEGATIVE_INFINITY
  return clusters.reduce((bestSimilarity, cluster, index) => {
    if (index === mergePair[0] || index === mergePair[1]) return bestSimilarity
    return Math.max(
      bestSimilarity,
      linkageSimilarity(normalizedEmbeddings, clusterA, cluster),
      linkageSimilarity(normalizedEmbeddings, clusterB, cluster),
    )
  }, Number.NEGATIVE_INFINITY)
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
    .sort((a, b) => b[2] - a[2])
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
  gapThreshold: number = 0,
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
  gapThreshold: number = 0,
): readonly Cluster[] {
  if (gapThreshold <= 0) {
    return linkage === 'single'
      ? buildClustersNormalized(normalizedEmbeddings, threshold, minClusterSize)
      : buildClustersNonSingle(normalizedEmbeddings, threshold, minClusterSize, linkage)
  }
  if (normalizedEmbeddings.length === 0) return []
  if (linkage === 'single') {
    return buildClustersSingleWithGap(normalizedEmbeddings, threshold, minClusterSize, gapThreshold)
  }
  return buildClustersNonSingle(normalizedEmbeddings, threshold, minClusterSize, linkage, gapThreshold)
}

function findWeakestInternalSimilarity(
  normalizedEmbeddings: readonly Float64Array[],
  cluster: readonly number[],
): number | undefined {
  let weakestSimilarity = Infinity
  for (let i = 0; i < cluster.length; i++) {
    const embI = normalizedEmbeddings[cluster[i]!]
    if (embI === undefined) continue
    for (let j = i + 1; j < cluster.length; j++) {
      const embJ = normalizedEmbeddings[cluster[j]!]
      if (embJ === undefined) continue
      const similarity = dotProduct(embI, embJ)
      if (similarity < weakestSimilarity) weakestSimilarity = similarity
    }
  }
  return weakestSimilarity === Infinity ? undefined : weakestSimilarity
}

function toIndexedSubEmbeddings(
  normalizedEmbeddings: readonly Float64Array[],
  cluster: readonly number[],
): readonly { readonly index: number; readonly embedding: Float64Array }[] {
  return cluster.flatMap((index) => {
    const embedding = normalizedEmbeddings[index]
    return embedding === undefined ? [] : ([{ index, embedding }] as const)
  })
}

function mapToGlobalClusters(
  indexedSubEmbeddings: readonly { readonly index: number; readonly embedding: Float64Array }[],
  localClusters: readonly Cluster[],
): readonly Cluster[] {
  return localClusters.map((localCluster) => localCluster.map((localIndex) => indexedSubEmbeddings[localIndex]!.index))
}

function reclusterOversizedCluster(
  normalizedEmbeddings: readonly Float64Array[],
  cluster: readonly number[],
  maxClusterSize: number,
  linkage: LinkageMode,
  thresholdStep: number,
): readonly Cluster[] {
  const weakestSimilarity = findWeakestInternalSimilarity(normalizedEmbeddings, cluster)
  const startingThreshold = Math.min(Math.max((weakestSimilarity ?? 1) + thresholdStep, 0), 1)
  const indexedSubEmbeddings = toIndexedSubEmbeddings(normalizedEmbeddings, cluster)
  if (indexedSubEmbeddings.length <= 1) return [cluster]

  const subEmbeddings = indexedSubEmbeddings.map(({ embedding }) => embedding)
  for (let threshold = startingThreshold; threshold <= 1; threshold = Math.min(threshold + thresholdStep, 1)) {
    const localClusters = buildClustersAdvanced(subEmbeddings, threshold, 1, linkage)
    if (localClusters.length <= 1 && threshold < 1) continue

    const globalClusters = mapToGlobalClusters(indexedSubEmbeddings, localClusters)
    if (globalClusters.length <= 1) return [cluster]

    return globalClusters.flatMap((globalCluster) =>
      globalCluster.length > maxClusterSize
        ? reclusterOversizedCluster(normalizedEmbeddings, globalCluster, maxClusterSize, linkage, thresholdStep)
        : [globalCluster],
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
): readonly Cluster[] {
  if (maxClusterSize <= 0 || thresholdStep <= 0) {
    return clusters.map((cluster) => [...cluster])
  }

  return clusters.flatMap((cluster) =>
    cluster.length > maxClusterSize
      ? reclusterOversizedCluster(normalizedEmbeddings, cluster, maxClusterSize, linkage, thresholdStep)
      : [[...cluster]],
  )
}
