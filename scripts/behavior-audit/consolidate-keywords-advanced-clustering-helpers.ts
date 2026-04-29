import { averageLinkageSimilarity, completeLinkageSimilarity } from './consolidate-keywords-clustering.js'
import type { LinkageMode } from './consolidate-keywords-clustering.js'

export type Cluster = readonly number[]
export type LinkageSimilarity = (
  embeddings: readonly Float64Array[],
  clusterA: readonly number[],
  clusterB: readonly number[],
) => number
export type AgglomerativeMerge = { readonly pair: readonly [number, number]; readonly similarity: number } | undefined

export function mergeClusters(clusters: readonly Cluster[], mergePair: readonly [number, number]): readonly Cluster[] {
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

export function filterClusters(clusters: readonly Cluster[], minClusterSize: number): readonly Cluster[] {
  return clusters.filter((cluster) => cluster.length >= minClusterSize)
}

export function getLinkageSimilarity(linkage: Exclude<LinkageMode, 'single'>): LinkageSimilarity {
  return linkage === 'average' ? averageLinkageSimilarity : completeLinkageSimilarity
}

export function findBestAgglomerativeMerge(
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

export function findBestAgglomerativeMergeWithGap(
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
