/**
 * Converts a color value to hex format
 * Handles numeric colors (converts to hex) and hex strings (passes through)
 * Returns '#000000' as default for invalid inputs
 */
export function numberToHexColor(color: unknown): string {
  if (typeof color === 'number') {
    return `#${color.toString(16).padStart(6, '0')}`
  }
  if (typeof color === 'string' && color.startsWith('#')) {
    return color
  }
  return '#000000'
}

/**
 * Converts a hex color string to a number
 * Returns 0 for undefined or invalid inputs
 */
export function hexColorToNumber(hex: string | undefined): number {
  if (hex === undefined) return 0
  return parseInt(hex.replace(/^#/, ''), 16) || 0
}
