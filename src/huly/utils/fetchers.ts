import tags, { type TagElement } from '@hcengineering/tags'
import tracker, { type Issue, type Project } from '@hcengineering/tracker'

import { ensureRef } from '../refs.js'

/**
 * Minimal client interface for entity fetching.
 * Uses method syntax for bivariant parameter checking,
 * allowing both HulyClient and test mocks to satisfy it.
 */
export interface FindOneClient {
  findOne(classRef: unknown, query: Record<string, unknown>, options?: unknown): Promise<unknown>
}

function assertDefined<T>(value: unknown, message: string): asserts value is T {
  if (value === undefined || value === null) {
    throw new Error(message)
  }
}

export async function fetchIssue(client: FindOneClient, issueId: string): Promise<Issue> {
  ensureRef<Issue>(issueId)
  const issue = await client.findOne(tracker.class.Issue, { _id: issueId })
  assertDefined<Issue>(issue, `Issue not found: ${issueId}`)
  return issue
}

export async function fetchProject(client: FindOneClient, projectId: string): Promise<Project> {
  ensureRef<Project>(projectId)
  const project = await client.findOne(tracker.class.Project, { _id: projectId })
  assertDefined<Project>(project, `Project not found: ${projectId}`)
  return project
}

export async function fetchLabel(client: FindOneClient, labelId: string): Promise<TagElement> {
  ensureRef<TagElement>(labelId)
  const label = await client.findOne(tags.class.TagElement, { _id: labelId })
  assertDefined<TagElement>(label, `Label not found: ${labelId}`)
  return label
}
