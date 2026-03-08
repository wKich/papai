import { describe, expect, it } from 'bun:test'

import { IssuePriority } from '@hcengineering/tracker'

import { mapInputPriorityToHuly, mapHulyPriorityToOutput } from '../../../src/huly/utils/priority.js'

describe('priority mapping', () => {
  describe('mapInputPriorityToHuly', () => {
    it('should map 0 to Huly NoPriority', () => {
      expect(mapInputPriorityToHuly(0)).toBe(IssuePriority.NoPriority)
    })

    it('should map 1 to Huly Urgent', () => {
      expect(mapInputPriorityToHuly(1)).toBe(IssuePriority.Urgent)
    })

    it('should map 2 to Huly High', () => {
      expect(mapInputPriorityToHuly(2)).toBe(IssuePriority.High)
    })

    it('should map 3 to Huly Medium', () => {
      expect(mapInputPriorityToHuly(3)).toBe(IssuePriority.Medium)
    })

    it('should map 4 to Huly Low', () => {
      expect(mapInputPriorityToHuly(4)).toBe(IssuePriority.Low)
    })

    it('should return NoPriority for undefined', () => {
      expect(mapInputPriorityToHuly(undefined)).toBe(IssuePriority.NoPriority)
    })

    it('should return NoPriority for unknown values', () => {
      expect(mapInputPriorityToHuly(999)).toBe(IssuePriority.NoPriority)
    })
  })

  describe('mapHulyPriorityToOutput', () => {
    it('should map Huly NoPriority to 0', () => {
      expect(mapHulyPriorityToOutput(IssuePriority.NoPriority)).toBe(0)
    })

    it('should map Huly Urgent to 1', () => {
      expect(mapHulyPriorityToOutput(IssuePriority.Urgent)).toBe(1)
    })

    it('should map Huly High to 2', () => {
      expect(mapHulyPriorityToOutput(IssuePriority.High)).toBe(2)
    })

    it('should map Huly Medium to 3', () => {
      expect(mapHulyPriorityToOutput(IssuePriority.Medium)).toBe(3)
    })

    it('should map Huly Low to 4', () => {
      expect(mapHulyPriorityToOutput(IssuePriority.Low)).toBe(4)
    })

    it('should return 0 for unknown values', () => {
      expect(mapHulyPriorityToOutput(999)).toBe(0)
    })
  })
})
