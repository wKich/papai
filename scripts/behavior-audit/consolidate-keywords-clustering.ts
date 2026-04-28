export type UnionFind = { parent: Int32Array; rank: Uint8Array }

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const dot = a.reduce((sum, ai, i) => sum + ai * (b[i] ?? 0), 0)
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0))
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0))
  return magA === 0 || magB === 0 ? 0 : dot / (magA * magB)
}

export function buildUnionFind(n: number): UnionFind {
  return {
    parent: Int32Array.from({ length: n }, (_, i) => i),
    rank: new Uint8Array(n),
  }
}

export function find(uf: UnionFind, i: number): number {
  if (uf.parent[i] !== i) {
    uf.parent[i] = find(uf, uf.parent[i]!)
  }
  return uf.parent[i]
}

export function union(uf: UnionFind, i: number, j: number): void {
  const ri = find(uf, i)
  const rj = find(uf, j)
  if (ri === rj) return
  if (uf.rank[ri]! < uf.rank[rj]!) {
    uf.parent[ri] = rj
  } else if (uf.rank[ri]! > uf.rank[rj]!) {
    uf.parent[rj] = ri
  } else {
    uf.parent[rj] = ri
    uf.rank[ri] = (uf.rank[ri] ?? 0) + 1
  }
}

export function buildClusters(
  embeddings: readonly (readonly number[])[],
  threshold: number,
  minClusterSize: number,
): readonly (readonly number[])[] {
  return buildClustersNormalized(toNormalizedFloat64Arrays(embeddings), threshold, minClusterSize)
}

export function toNormalizedFloat64Arrays(embeddings: readonly (readonly number[])[]): readonly Float64Array[] {
  return embeddings.map((emb) => {
    const arr = new Float64Array(emb.length)
    let mag = 0
    for (let k = 0; k < emb.length; k++) {
      const v = emb[k] ?? 0
      arr[k] = v
      mag += v * v
    }
    mag = Math.sqrt(mag)
    if (mag > 0) {
      for (let k = 0; k < arr.length; k++) {
        arr[k] = arr[k]! / mag
      }
    }
    return arr
  })
}

export function dotProduct(a: Float64Array, b: Float64Array): number {
  let sum = 0
  const len = Math.min(a.length, b.length)
  for (let k = 0; k < len; k++) {
    sum += a[k]! * b[k]!
  }
  return sum
}

export function averageLinkageSimilarity(
  embeddings: readonly Float64Array[],
  clusterA: readonly number[],
  clusterB: readonly number[],
): number {
  if (clusterA.length === 0 || clusterB.length === 0) return 0
  let total = 0
  let count = 0
  for (const i of clusterA) {
    const embI = embeddings[i]
    if (embI === undefined) continue
    for (const j of clusterB) {
      const embJ = embeddings[j]
      if (embJ === undefined) continue
      total += dotProduct(embI, embJ)
      count++
    }
  }
  return count === 0 ? 0 : total / count
}

export function completeLinkageSimilarity(
  embeddings: readonly Float64Array[],
  clusterA: readonly number[],
  clusterB: readonly number[],
): number {
  if (clusterA.length === 0 || clusterB.length === 0) return 0
  let minSimilarity = Infinity
  for (const i of clusterA) {
    const embI = embeddings[i]
    if (embI === undefined) continue
    for (const j of clusterB) {
      const embJ = embeddings[j]
      if (embJ === undefined) continue
      const similarity = dotProduct(embI, embJ)
      if (similarity < minSimilarity) {
        minSimilarity = similarity
      }
    }
  }
  return minSimilarity === Infinity ? 0 : minSimilarity
}

export type LinkageMode = 'single' | 'average' | 'complete'

export function buildClustersNormalized(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
): readonly (readonly number[])[] {
  const n = normalizedEmbeddings.length
  const uf = buildUnionFind(n)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const embI = normalizedEmbeddings[i]
      const embJ = normalizedEmbeddings[j]
      if (embI !== undefined && embJ !== undefined && dotProduct(embI, embJ) >= threshold) {
        union(uf, i, j)
      }
    }
  }

  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const root = find(uf, i)
    const group = groups.get(root)
    if (group === undefined) {
      groups.set(root, [i])
    } else {
      group.push(i)
    }
  }

  return [...groups.values()].filter((group) => group.length >= minClusterSize).map((group) => [...group])
}
