import { z } from 'zod'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'kaneo:provision' })

const SignUpResponseSchema = z.object({
  user: z.object({ id: z.string() }),
  // Better Auth returns the session token either at the top level or nested under session
  token: z.string().optional(),
  session: z.object({ token: z.string() }).optional(),
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

async function doSignUp(
  baseUrl: string,
  clientUrl: string,
  email: string,
  password: string,
  name: string,
): Promise<string> {
  log.debug({ email }, 'Kaneo sign-up')
  const res = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: clientUrl },
    body: JSON.stringify({ email, password, name }),
  })
  if (!res.ok) {
    throw new Error(`Sign-up failed (${res.status}): ${await res.text()}`)
  }
  const rawData: unknown = await res.json()
  const parsed = SignUpResponseSchema.safeParse(rawData)
  if (!parsed.success) throw new Error('Sign-up returned invalid data')
  const setCookies = res.headers.getSetCookie()
  const sessionHeader = setCookies.find((h) => h.startsWith('better-auth.session_token='))
  if (sessionHeader !== undefined) return sessionHeader.split(';')[0]!
  // Better Auth also returns the session token in the response body — use it to build the cookie
  const bodyToken = parsed.data.token ?? parsed.data.session?.token
  if (bodyToken !== undefined) return `better-auth.session_token=${bodyToken}`
  throw new Error('Sign-up response missing session cookie')
}

async function doCreateWorkspace(
  baseUrl: string,
  clientUrl: string,
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
      Origin: clientUrl,
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

async function doCreateApiKey(baseUrl: string, clientUrl: string, sessionCookie: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/api-key/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, Origin: clientUrl },
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
  /** Public-facing web client URL used as Origin header (e.g. https://kaneo.example.com) */
  clientUrl: string,
  telegramId: number,
  username: string | null,
): Promise<ProvisionResult> {
  const email = `papai_${telegramId}@papai.local`
  const password = generatePassword()
  const name = username === null ? `User ${telegramId}` : `@${username}`
  const slug = `papai-${telegramId}`

  log.info({ telegramId, email }, 'Provisioning Kaneo user account')
  const sessionCookie = await doSignUp(baseUrl, clientUrl, email, password, name)
  const workspaceId = await doCreateWorkspace(baseUrl, clientUrl, sessionCookie, name, slug)

  let kaneoKey = sessionCookie
  try {
    kaneoKey = await doCreateApiKey(baseUrl, clientUrl, sessionCookie)
    log.info({ telegramId }, 'Created API key for provisioned user')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn({ telegramId, error: msg }, 'API key endpoint unavailable — using session cookie as key')
  }

  log.info({ telegramId, workspaceId }, 'Kaneo user provisioned')
  return { email, password, kaneoKey, workspaceId }
}
