import type { ToolSet } from 'ai'

import { makeAddCommentTool } from './add-comment.js'
import { makeCreateIssueTool } from './create-issue.js'
import { makeCreateLabelTool } from './create-label.js'
import { makeCreateProjectTool } from './create-project.js'
import { makeCreateRelationTool } from './create-relation.js'
import { makeGetCommentsTool } from './get-comments.js'
import { makeGetIssueLabelsTool } from './get-issue-labels.js'
import { makeGetIssueTool } from './get-issue.js'
import { makeGetRelationsTool } from './get-relations.js'
import { makeListLabelsTool } from './list-labels.js'
import { makeListProjectsTool } from './list-projects.js'
import { makeRemoveIssueLabelTool } from './remove-issue-label.js'
import { makeSearchIssuesTool } from './search-issues.js'
import { makeUpdateIssueTool } from './update-issue.js'

type ToolConfig = { linearKey: string; linearTeamId: string }

export function makeTools({ linearKey, linearTeamId }: ToolConfig): ToolSet {
  return {
    create_issue: makeCreateIssueTool(linearKey, linearTeamId),
    update_issue: makeUpdateIssueTool(linearKey),
    search_issues: makeSearchIssuesTool(linearKey),
    list_projects: makeListProjectsTool(linearKey),
    add_comment: makeAddCommentTool(linearKey),
    get_comments: makeGetCommentsTool(linearKey),
    list_labels: makeListLabelsTool(linearKey, linearTeamId),
    get_issue_labels: makeGetIssueLabelsTool(linearKey),
    create_relation: makeCreateRelationTool(linearKey),
    get_relations: makeGetRelationsTool(linearKey),
    get_issue: makeGetIssueTool(linearKey),
    create_label: makeCreateLabelTool(linearKey, linearTeamId),
    create_project: makeCreateProjectTool(linearKey, linearTeamId),
    remove_issue_label: makeRemoveIssueLabelTool(linearKey),
  }
}
