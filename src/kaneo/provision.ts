import { z } from 'zod'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'kaneo:provision' })

// Provision-specific schemas kept local as they are for auth endpoints, not Kaneo API
const SignUpResponseSchema = z.object({
  user: z.object({ id: z.string() }),
  token: z.string(),
})
const OrgResponseSchema = z.object({ id: z.string(), slug: z.string() })
const ApiKeyResponseSchema = z.object({ key: z.string() })

export type ProvisionResult = {
  email: string
  password: string
  /** Better Auth API key (preferred) or session cookie (fallback). */
  kaneoKey: string
  workspaceId: string
}

function generatePassword(): string {
  const uuid = crypto.randomUUID().replaceAll('-', '')
  return `${uuid.slice(0, 20)}Aa1!`
}

async function doSignUp(baseUrl: string, email: string, password: string, name: string): Promise<string> {
  log.debug({ email }, 'Kaneo sign-up')
  const res = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  })
  if (!res.ok) {
    throw new Error(`Sign-up failed (${res.status}): ${await res.text()}`)
  }
  const rawData: unknown = await res.json()
  const parsed = SignUpResponseSchema.safeParse(rawData)
  if (!parsed.success) throw new Error('Sign-up returned invalid data')
  log.debug({ userId: parsed.data.user.id }, 'Kaneo sign-up complete')

  const setCookies = res.headers.getSetCookie()
  // In HTTPS deployments better-auth prefixes the cookie name with __Secure-,
  // so match on substring rather than exact prefix.
  const sessionHeader = setCookies.find((h) => h.includes('better-auth.session_token='))
  if (sessionHeader !== undefined) {
    // Extract just the name=value pair (drop Secure/HttpOnly/Path/Max-Age attrs).
    // Keep the full cookie name including any __Secure- prefix — the name must
    // match exactly when sent back in the Cookie header.
    return sessionHeader.split(';')[0]!
  }

  // better-auth may not set a cookie when called from a server-side context
  // (e.g. behind a reverse proxy with no client IP). Fall back to constructing
  // the cookie from the token returned in the JSON body.
  // Use the __Secure- prefix when the endpoint is HTTPS, matching better-auth behaviour.
  const cookieName = baseUrl.startsWith('https://') ? '__Secure-better-auth.session_token' : 'better-auth.session_token'
  log.debug({ email, cookieName }, 'No session cookie in sign-up response; constructing from JSON token')
  return `${cookieName}=${parsed.data.token}`
}

async function doCreateWorkspace(
  baseUrl: string,
  trustedOrigin: string,
  sessionCookie: string,
  name: string,
  slug: string,
): Promise<string> {
  log.debug({ name }, 'Creating Kaneo workspace')
  const res = await fetch(`${baseUrl}/api/auth/organization/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
      Origin: trustedOrigin,
    },
    body: JSON.stringify({ name, slug }),
  })
  if (!res.ok) {
    throw new Error(`Workspace creation failed (${res.status}): ${await res.text()}`)
  }
  const rawData: unknown = await res.json()
  const parsed = OrgResponseSchema.safeParse(rawData)
  if (!parsed.success) throw new Error('Workspace creation returned invalid data')
  return parsed.data.id
}

async function doCreateApiKey(baseUrl: string, trustedOrigin: string, sessionCookie: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/api-key/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, Origin: trustedOrigin },
    body: JSON.stringify({ name: 'papai-bot' }),
  })
  if (!res.ok) throw new Error(`API key creation failed (${res.status}): ${await res.text()}`)
  const rawData: unknown = await res.json()
  const parsed = ApiKeyResponseSchema.safeParse(rawData)
  if (!parsed.success) throw new Error('API key response invalid')
  return parsed.data.key
}

/**
 * Provisions a new Kaneo account for a Telegram user:
 * signs up, creates a workspace, and generates an API key (falling back to
 * the session token if the API key endpoint is unavailable).
 */
export async function provisionKaneoUser(
  /** Internal API base URL (e.g. http://kaneo-api:1337) */
  baseUrl: string,
  /** Public-facing web client URL — used as the trusted Origin for all auth requests. */
  publicUrl: string,
  telegramId: number,
  username: string | null,
): Promise<ProvisionResult> {
  const email = username === null ? `${telegramId}@pap.ai` : `${username}@pap.ai`
  const password = generatePassword()
  const name = username === null ? `User ${telegramId}` : `@${username}`
  const slug = `papai-${telegramId}`

  log.info({ telegramId, email }, 'Provisioning Kaneo user account')
  const trustedOrigin = publicUrl === '' ? baseUrl : publicUrl
  const sessionCookie = await doSignUp(baseUrl, email, password, name)
  const workspaceId = await doCreateWorkspace(baseUrl, trustedOrigin, sessionCookie, name, slug)

  let kaneoKey = sessionCookie
  try {
    kaneoKey = await doCreateApiKey(baseUrl, trustedOrigin, sessionCookie)
    log.info({ telegramId }, 'Created API key for provisioned user')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn({ telegramId, error: msg }, 'API key endpoint unavailable — using session token as key')
  }

  log.info({ telegramId, workspaceId }, 'Kaneo user provisioned')
  return { email, password, kaneoKey, workspaceId }
}
