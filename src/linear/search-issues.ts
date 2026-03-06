import { SortingOrder } from '@hcengineering/core'
import tracker from '@hcengineering/tracker'
import type { Issue, Project } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

const log = logger.child({ scope: 'huly:search-issues' })

type IssueResult = {
  id: string
  identifier: string
  title: string
  priority: number
  url: string
}

type SearchIssuesParams = {
  userId: number
  projectId: string
  query?: string
  state?: string
  labelName?: string
  labelId?: string
  dueDateBefore?: string
  dueDateAfter?: string
  estimate?: number
}

function mapPriorityToNumber(hulyPriority: number): number {
  // Huly: NoPriority=0, Low=1, Medium=2, High=3, Urgent=4
  // Linear: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low
  switch (hulyPriority) {
    case 0:
      return 0 // No Priority
    case 4:
      return 1 // Urgent
    case 3:
      return 2 // High
    case 2:
      return 3 // Medium
    case 1:
      return 4 // Low
    default:
      return 0
  }
}

export async function searchIssues({
  userId,
  projectId,
  query,
  state,
  labelName,
  labelId,
  dueDateBefore,
  dueDateAfter,
  estimate,
}: SearchIssuesParams): Promise<IssueResult[]> {
  log.debug(
    { userId, projectId, query, state, labelName, labelId, dueDateBefore, dueDateAfter, estimate },
    'searchIssues called',
  )

  const client = await getHulyClient(userId)

  try {
    // Build query for Huly
    const hulyQuery: Record<string, unknown> = { space: projectId }

    // Use $like for title search (Huly doesn't have full-text search like Linear)
    if (query !== undefined && query.length > 0) {
      hulyQuery['title'] = { $like: `%${query}%` }
    }

    // Filter by state name
    if (state !== undefined) {
      // We need to fetch the state ID first
      const statusQuery = await client.findAll(tracker.class.IssueStatus, { name: state } as unknown as Parameters<
        typeof client.findAll
      >[1])

      if (statusQuery.length > 0) {
        const statusResult = statusQuery[0] as unknown as { _id: string }
        hulyQuery['status'] = statusResult._id
      }
    }

    // Filter by due date
    if (dueDateBefore !== undefined || dueDateAfter !== undefined) {
      const dateFilter: Record<string, number> = {}
      if (dueDateBefore !== undefined) {
        dateFilter['$lt'] = new Date(dueDateBefore).getTime()
      }
      if (dueDateAfter !== undefined) {
        dateFilter['$gt'] = new Date(dueDateAfter).getTime()
      }
      hulyQuery['dueDate'] = dateFilter
    }

    // Filter by estimate
    if (estimate !== undefined) {
      hulyQuery['estimation'] = estimate
    }

    // Fetch issues
    const issues = (await client.findAll(
      tracker.class.Issue,
      hulyQuery as unknown as Parameters<typeof client.findAll>[1],
      { sort: { modifiedOn: SortingOrder.Descending } } as unknown as Parameters<typeof client.findAll>[2],
    )) as unknown as Issue[]

    // Filter by label if specified (post-search filter since Huly doesn't support $like on labels in findAll)
    let filteredIssues = issues
    if (labelName !== undefined || labelId !== undefined) {
      // For simplicity, we'll skip label filtering for now as it requires additional lookups
      // This is a degraded feature compared to Linear
      log.warn({ userId, labelName, labelId }, 'Label filtering not fully implemented for Huly')
    }

    // Map results
    const hulyUrl = process.env['HULY_URL'] ?? ''
    const hulyWorkspace = process.env['HULY_WORKSPACE'] ?? ''
    const project = (await client.findOne(tracker.class.Project, {
      _id: projectId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as Project | undefined

    const projectIdentifier = project?.identifier ?? 'UNK'

    const results: IssueResult[] = filteredIssues.map((issue) => ({
      id: issue._id as string,
      identifier: issue.identifier,
      title: issue.title,
      priority: mapPriorityToNumber(issue.priority as number),
      url: `${hulyUrl}/workbench/${hulyWorkspace}/tracker/${projectIdentifier}/${issue.identifier}`,
    }))

    log.info({ userId, projectId, query, state, resultCount: results.length }, 'Issues searched')

    return results
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), userId, projectId, query },
      'searchIssues failed',
    )
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
