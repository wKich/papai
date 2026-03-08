import tracker, { type Issue } from '@hcengineering/tracker'

import { logger } from '../../logger.js'
import { hulyUrl, hulyWorkspace } from '../env.js'
import type { HulyClient } from '../types.js'

const log = logger.child({ scope: 'huly:url-builder' })

/**
 * Builds a URL for an issue, looking up the project identifier
 * Falls back to 'UNK' if project cannot be determined
 */
export async function buildIssueUrl(client: HulyClient, issue: Issue): Promise<string> {
  const project = await client.findOne(tracker.class.Project, { _id: issue.space })

  if (project !== undefined && project !== null && 'identifier' in project) {
    return buildIssueUrlByIdentifier(String(project.identifier), issue.identifier)
  }

  log.warn({ space: issue.space }, 'Failed to find Project for URL building')
  return buildIssueUrlByIdentifier('UNK', issue.identifier)
}

/**
 * Builds a URL from known project and issue identifiers
 */
export function buildIssueUrlByIdentifier(projectIdentifier: string, issueIdentifier: string): string {
  return `${hulyUrl}/workbench/${hulyWorkspace}/tracker/${projectIdentifier}/${issueIdentifier}`
}
