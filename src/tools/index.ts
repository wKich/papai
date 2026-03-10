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

type ToolConfig = { linearKey: string; linearTeamId: string }

export function makeTools({ linearKey, linearTeamId }: ToolConfig): ToolSet {
  return {
    create_issue: makeCreateIssueTool(linearKey, linearTeamId),
    update_issue: makeUpdateIssueTool(linearKey),
    search_issues: makeSearchIssuesTool(linearKey),
    list_projects: makeListProjectsTool(linearKey),
    update_project: makeUpdateProjectTool(linearKey),
    archive_project: makeArchiveProjectTool(linearKey),
    add_issue_comment: makeAddIssueCommentTool(linearKey),
    get_issue_comments: makeGetIssueCommentsTool(linearKey),
    update_issue_comment: makeUpdateIssueCommentTool(linearKey),
    remove_issue_comment: makeRemoveIssueCommentTool(linearKey),
    list_labels: makeListLabelsTool(linearKey, linearTeamId),
    create_label: makeCreateLabelTool(linearKey, linearTeamId),
    update_label: makeUpdateLabelTool(linearKey),
    remove_label: makeRemoveLabelTool(linearKey),
    add_issue_label: makeAddIssueLabelTool(linearKey),
    remove_issue_label: makeRemoveIssueLabelTool(linearKey),
    add_issue_relation: makeAddIssueRelationTool(linearKey),
    update_issue_relation: makeUpdateIssueRelationTool(linearKey),
    remove_issue_relation: makeRemoveIssueRelationTool(linearKey),
    get_issue: makeGetIssueTool(linearKey),
    create_project: makeCreateProjectTool(linearKey, linearTeamId),
    archive_issue: makeArchiveIssueTool(linearKey),
  }
}
