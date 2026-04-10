// Length of fence markers for chunk budget calculations
// FENCE_CLOSE_LEN represents the length of newline + three backticks
const FENCE_CLOSE_LEN = 4
// FENCE_OPEN_LEN represents the length of three backticks + newline
const FENCE_OPEN_LEN = 4

/**
 * Split a string into chunks no longer than `maxLen`, preferring to split
 * on paragraph breaks, then sentence breaks, then word breaks. If a fenced
 * code block would be split, emit a synthetic closing and reopening fence
 * so each chunk remains syntactically balanced.
 */
export function chunkForDiscord(input: string, maxLen: number): string[] {
  if (input.length <= maxLen) return [input]

  const chunks: string[] = []
  let remainder = input
  let carriedOpenFence = false

  while (remainder.length > maxLen) {
    // Reserve space for fence operations:
    // - Opening fence from previous chunk (if carriedOpenFence)
    // - Potential closing fence for this chunk (we must reserve for worst case)
    let budget = maxLen - FENCE_CLOSE_LEN
    if (carriedOpenFence) {
      budget = budget - FENCE_OPEN_LEN
    }
    const sliceEnd = findSplitPoint(remainder, budget)
    let chunk = remainder.slice(0, sliceEnd)
    remainder = remainder.slice(sliceEnd)

    if (carriedOpenFence) {
      chunk = '```\n' + chunk
      carriedOpenFence = false
    }

    const fenceCount = (chunk.match(/```/g) ?? []).length
    if (fenceCount % 2 === 1) {
      chunk = chunk + '\n```'
      carriedOpenFence = true
    }

    chunks.push(chunk)
  }

  if (remainder.length > 0) {
    let tail = remainder
    if (carriedOpenFence) {
      tail = '```\n' + tail
    }
    chunks.push(tail)
  }

  return chunks
}

function findSplitPoint(text: string, maxLen: number): number {
  if (text.length <= maxLen) return text.length

  const paragraph = text.lastIndexOf('\n\n', maxLen)
  if (paragraph > 0) return paragraph + 2

  const newline = text.lastIndexOf('\n', maxLen)
  if (newline > 0) return newline + 1

  for (let i = maxLen; i > maxLen / 2; i--) {
    const ch = text[i]
    if (ch === '.' || ch === '!' || ch === '?') return i + 1
  }

  const ws = text.lastIndexOf(' ', maxLen)
  if (ws > 0) return ws + 1

  return maxLen
}
