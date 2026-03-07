import type { Doc, Ref } from '@hcengineering/core'

export function ensureRef<T extends Doc>(id: string): asserts id is Ref<T> {
  if (id.length === 0) {
    throw new Error('ID must not be empty')
  }
}
