import { describe, expect, it } from 'bun:test'

import { mapInputPriorityToHuly, mapHulyPriorityToOutput } from '../../../src/huly/utils/priority.js'

describe('priority mapping', () => {
  describe('mapInputPriorityToHuly', () => {
    it('should map 0 to Huly NoPriority', () => {
      expect(mapInputPriorityToHuly(0)).toBe(0)
    })

    it('should map 1 to Huly Urgent', () => {
      expect(mapInputPriorityToHuly(1)).toBe(1)
    })

    it('should map 2 to Huly High', () => {
      expect(mapInputPriorityToHuly(2)).toBe(2)
    })

    it('should map 3 to Huly Medium', () => {
      expect(mapInputPriorityToHuly(3)).toBe(3)
    })

    it('should map 4 to Huly Low', () => {
      expect(mapInputPriorityToHuly(4)).toBe(4)
    })

    it('should return NoPriority for undefined', () => {
      expect(mapInputPriorityToHuly(undefined)).toBe(0)
    })

    it('should return NoPriority for unknown values', () => {
      expect(mapInputPriorityToHuly(999)).toBe(0)
    })
  })

  describe('mapHulyPriorityToOutput', () => {
    it('should map Huly NoPriority(0) to 0', () => {
      expect(mapHulyPriorityToOutput(0)).toBe(0)
    })

    it('should map Huly Urgent(1) to 4', () => {
      expect(mapHulyPriorityToOutput(1)).toBe(4)
    })

    it('should map Huly High(2) to 3', () => {
      expect(mapHulyPriorityToOutput(2)).toBe(3)
    })

    it('should map Huly Medium(3) to 2', () => {
      expect(mapHulyPriorityToOutput(3)).toBe(2)
    })

    it('should map Huly Low(4) to 1', () => {
      expect(mapHulyPriorityToOutput(4)).toBe(1)
    })

    it('should return 0 for unknown values', () => {
      expect(mapHulyPriorityToOutput(999)).toBe(0)
    })
  })
})
