import { logger } from '../logger.js'

const log = logger.child({ scope: 'huly:env' })

function getRequiredEnvVar(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    log.error({ variable: name }, 'Required environment variable not set')
    throw new Error(`${name} environment variable is required`)
  }
  return value
}

export const hulyUrl: string = getRequiredEnvVar('HULY_URL')
export const hulyWorkspace: string = getRequiredEnvVar('HULY_WORKSPACE')
