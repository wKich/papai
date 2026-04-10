import { logger } from '../logger.js'

const log = logger.child({ scope: 'identity:nl-detection' })

/** Patterns that indicate user is claiming an identity */
const IDENTITY_CLAIM_PATTERNS = [
  // "I'm jsmith" or "I am jsmith"
  /(?:i['']?m|i am)\s+(?:not\s+\w+,?\s*)?(?:i['']?m|i am)?\s*(\w+)/i,
  // "My login is jsmith" or "My username is jsmith"
  /my\s+(?:login|username|user)\s+is\s+(\w+)/i,
  // "Link me to user jsmith" or "Link me to jsmith"
  /link\s+me\s+(?:to\s+)?(?:user\s+)?(\w+)/i,
  // "I'm actually jsmith" or "I am actually jsmith"
  /(?:i['']?m|i am)\s+actually\s+(\w+)/i,
  // "These aren't my tasks, I'm jsmith"
  /these\s+(?:aren['']?t|are not)\s+my\s+\w+,?\s*(?:i['']?m|i am)\s+(\w+)/i,
]

/** Patterns that indicate user is denying their current identity */
const IDENTITY_DENIAL_PATTERNS = [
  // "I'm not Alice"
  /i['']?m\s+not\s+\w+/i,
  // "That's not me" or "This isn't me"
  /(?:that|this)(?:['']?s| is) not me/i,
  // "These aren't my tasks"
  /these\s+(?:aren['']?t|are not)\s+my\s+\w+/i,
  // "Unlink my account"
  /unlink\s+my\s+(?:account|identity)/i,
]

/**
 * Extract claimed identity from natural language message.
 * Returns the claimed login/username or null if not a claim.
 */
export function extractIdentityClaim(text: string): string | null {
  log.debug({ text }, 'extractIdentityClaim called')

  for (const pattern of IDENTITY_CLAIM_PATTERNS) {
    const match = text.match(pattern)
    if (match !== null && match[1] !== undefined) {
      const claimed = match[1].trim().toLowerCase()
      log.debug({ claimed }, 'Identity claim detected')
      return claimed
    }
  }

  return null
}

/**
 * Check if text contains an identity claim.
 */
export function isIdentityClaim(text: string): boolean {
  return extractIdentityClaim(text) !== null
}

/**
 * Check if text contains an identity denial.
 */
export function extractIdentityDenial(text: string): boolean {
  log.debug({ text }, 'extractIdentityDenial called')

  for (const pattern of IDENTITY_DENIAL_PATTERNS) {
    if (pattern.test(text)) {
      log.debug('Identity denial detected')
      return true
    }
  }

  return false
}

/**
 * Check if text contains an identity denial.
 */
export function isIdentityDenial(text: string): boolean {
  return extractIdentityDenial(text)
}
