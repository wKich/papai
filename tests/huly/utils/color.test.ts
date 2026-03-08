import { describe, expect, it } from 'bun:test'

import { numberToHexColor, hexColorToNumber } from '../../../src/huly/utils/color.js'

describe('numberToHexColor', () => {
  it('should convert number to hex color', () => {
    expect(numberToHexColor(0)).toBe('#000000')
    expect(numberToHexColor(255)).toBe('#0000ff')
    expect(numberToHexColor(16777215)).toBe('#ffffff')
    expect(numberToHexColor(16711680)).toBe('#ff0000')
  })

  it('should return hex string as-is if already hex', () => {
    expect(numberToHexColor('#ff0000')).toBe('#ff0000')
    expect(numberToHexColor('#00ff00')).toBe('#00ff00')
  })

  it('should return default black for undefined', () => {
    expect(numberToHexColor(undefined)).toBe('#000000')
  })

  it('should return default black for null', () => {
    expect(numberToHexColor(null)).toBe('#000000')
  })

  it('should return default black for invalid strings', () => {
    expect(numberToHexColor('not-a-color')).toBe('#000000')
  })
})

describe('hexColorToNumber', () => {
  it('should convert hex to number', () => {
    expect(hexColorToNumber('#ff0000')).toBe(16711680)
    expect(hexColorToNumber('#000000')).toBe(0)
    expect(hexColorToNumber('#ffffff')).toBe(16777215)
  })

  it('should handle hex without # prefix', () => {
    expect(hexColorToNumber('ff0000')).toBe(16711680)
  })

  it('should return 0 for undefined', () => {
    expect(hexColorToNumber(undefined)).toBe(0)
  })
})
