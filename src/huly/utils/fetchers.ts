import tags, { type TagElement } from '@hcengineering/tags'
import tracker, { type Issue, type Project } from '@hcengineering/tracker'

import { ensureRef } from '../refs.js'
import type { HulyClient } from '../types.js'

export async function fetchIssue(client: HulyClient, issueId: string): Promise<Issue> {
  ensureRef<Issue>(issueId)
  const issue = await client.findOne(tracker.class.Issue, { _id: issueId })

  if (issue === undefined || issue === null) {
    throw new Error(`Issue not found: ${issueId}`)
  }
  return issue
}

export async function fetchProject(client: HulyClient, projectId: string): Promise<Project> {
  ensureRef<Project>(projectId)
  const project = await client.findOne(tracker.class.Project, { _id: projectId })

  if (project === undefined || project === null) {
    throw new Error(`Project not found: ${projectId}`)
  }
  return project
}

export async function fetchLabel(client: HulyClient, labelId: string): Promise<TagElement> {
  ensureRef<TagElement>(labelId)
  const label = await client.findOne(tags.class.TagElement, { _id: labelId })

  if (label === undefined || label === null) {
    throw new Error(`Label not found: ${labelId}`)
  }
  return label
}
