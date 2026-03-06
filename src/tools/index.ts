import type { ToolSet } from 'ai'

import { makeAddIssueCommentTool } from './add-issue-comment.js'
import { makeAddIssueLabelTool } from './add-issue-label.js'
import { makeAddIssueRelationTool } from './add-issue-relation.js'
import { makeArchiveIssueTool } from './archive-issue.js'
import { makeArchiveProjectTool } from './archive-project.js'
import { makeCreateIssueTool } from './create-issue.js'
import { makeCreateLabelTool } from './create-label.js'
import { makeCreateProjectTool } from './create-project.js'
import { makeGetIssueCommentsTool } from './get-issue-comments.js'
import { makeGetIssueTool } from './get-issue.js'
import { makeListLabelsTool } from './list-labels.js'
import { makeListProjectsTool } from './list-projects.js'
import { makeRemoveIssueCommentTool } from './remove-issue-comment.js'
import { makeRemoveIssueLabelTool } from './remove-issue-label.js'
import { makeRemoveIssueRelationTool } from './remove-issue-relation.js'
import { makeRemoveLabelTool } from './remove-label.js'
import { makeSearchIssuesTool } from './search-issues.js'
import { makeUpdateIssueCommentTool } from './update-issue-comment.js'
import { makeUpdateIssueRelationTool } from './update-issue-relation.js'
import { makeUpdateIssueTool } from './update-issue.js'
import { makeUpdateLabelTool } from './update-label.js'
import { makeUpdateProjectTool } from './update-project.js'

type ToolConfig = { userId: number }

export function makeTools({ userId }: ToolConfig): ToolSet {
  return {
    create_issue: makeCreateIssueTool(userId),
    update_issue: makeUpdateIssueTool(userId),
    search_issues: makeSearchIssuesTool(userId),
    list_projects: makeListProjectsTool(userId),
    update_project: makeUpdateProjectTool(userId),
    archive_project: makeArchiveProjectTool(userId),
    add_issue_comment: makeAddIssueCommentTool(userId),
    get_issue_comments: makeGetIssueCommentsTool(userId),
    update_issue_comment: makeUpdateIssueCommentTool(userId),
    remove_issue_comment: makeRemoveIssueCommentTool(userId),
    list_labels: makeListLabelsTool(userId),
    create_label: makeCreateLabelTool(userId),
    update_label: makeUpdateLabelTool(userId),
    remove_label: makeRemoveLabelTool(userId),
    add_issue_label: makeAddIssueLabelTool(userId),
    remove_issue_label: makeRemoveIssueLabelTool(userId),
    add_issue_relation: makeAddIssueRelationTool(userId),
    update_issue_relation: makeUpdateIssueRelationTool(userId),
    remove_issue_relation: makeRemoveIssueRelationTool(userId),
    get_issue: makeGetIssueTool(userId),
    create_project: makeCreateProjectTool(userId),
    archive_issue: makeArchiveIssueTool(userId),
  }
}
