// Set up env vars before any imports
process.env['HULY_URL'] = 'http://localhost:8087'
process.env['HULY_WORKSPACE'] = 'test-workspace'

import { describe, expect, test } from 'bun:test'

import { setupAddIssueCommentMock } from '../../src/huly/__mocks__/add-issue-comment.js'
import { setupAddIssueLabelMock } from '../../src/huly/__mocks__/add-issue-label.js'
import { setupAddIssueRelationMock } from '../../src/huly/__mocks__/add-issue-relation.js'
import { setupArchiveIssueMock } from '../../src/huly/__mocks__/archive-issue.js'
import { setupArchiveProjectMock } from '../../src/huly/__mocks__/archive-project.js'
import { setupCreateIssueMock } from '../../src/huly/__mocks__/create-issue.js'
import { setupCreateLabelMock } from '../../src/huly/__mocks__/create-label.js'
import { setupCreateProjectMock } from '../../src/huly/__mocks__/create-project.js'
import { setupGetIssueCommentsMock } from '../../src/huly/__mocks__/get-issue-comments.js'
import { setupGetIssueMock } from '../../src/huly/__mocks__/get-issue.js'
import { setupListLabelsMock } from '../../src/huly/__mocks__/list-labels.js'
import { setupListProjectsMock } from '../../src/huly/__mocks__/list-projects.js'
import { setupRemoveIssueCommentMock } from '../../src/huly/__mocks__/remove-issue-comment.js'
import { setupRemoveIssueLabelMock } from '../../src/huly/__mocks__/remove-issue-label.js'
import { setupRemoveIssueRelationMock } from '../../src/huly/__mocks__/remove-issue-relation.js'
import { setupRemoveLabelMock } from '../../src/huly/__mocks__/remove-label.js'
import { setupSearchIssuesMock } from '../../src/huly/__mocks__/search-issues.js'
import { setupUpdateIssueCommentMock } from '../../src/huly/__mocks__/update-issue-comment.js'
import { setupUpdateIssueRelationMock } from '../../src/huly/__mocks__/update-issue-relation.js'
import { setupUpdateIssueMock } from '../../src/huly/__mocks__/update-issue.js'
import { setupUpdateLabelMock } from '../../src/huly/__mocks__/update-label.js'
import { setupUpdateProjectMock } from '../../src/huly/__mocks__/update-project.js'
import { makeAddIssueCommentTool } from '../../src/tools/add-issue-comment.js'
import { makeAddIssueLabelTool } from '../../src/tools/add-issue-label.js'
import { makeAddIssueRelationTool } from '../../src/tools/add-issue-relation.js'
import { makeArchiveIssueTool } from '../../src/tools/archive-issue.js'
import { makeArchiveProjectTool } from '../../src/tools/archive-project.js'
import { makeCreateIssueTool } from '../../src/tools/create-issue.js'
import { makeCreateLabelTool } from '../../src/tools/create-label.js'
import { makeCreateProjectTool } from '../../src/tools/create-project.js'
import { makeGetIssueCommentsTool } from '../../src/tools/get-issue-comments.js'
import { makeGetIssueTool } from '../../src/tools/get-issue.js'
import { makeListLabelsTool } from '../../src/tools/list-labels.js'
import { makeListProjectsTool } from '../../src/tools/list-projects.js'
import { makeRemoveIssueCommentTool } from '../../src/tools/remove-issue-comment.js'
import { makeRemoveIssueLabelTool } from '../../src/tools/remove-issue-label.js'
import { makeRemoveIssueRelationTool } from '../../src/tools/remove-issue-relation.js'
import { makeRemoveLabelTool } from '../../src/tools/remove-label.js'
import { makeSearchIssuesTool } from '../../src/tools/search-issues.js'
import { makeUpdateIssueCommentTool } from '../../src/tools/update-issue-comment.js'
import { makeUpdateIssueRelationTool } from '../../src/tools/update-issue-relation.js'
import { makeUpdateIssueTool } from '../../src/tools/update-issue.js'
import { makeUpdateLabelTool } from '../../src/tools/update-label.js'
import { makeUpdateProjectTool } from '../../src/tools/update-project.js'

const mockApiKey = 'test-api-key'
const mockTeamId = 'team-123'

describe('create_issue tool', () => {
  test('executes successfully with minimal params', async () => {
    setupCreateIssueMock()
    const tool = makeCreateIssueTool(mockApiKey, mockTeamId)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec({ title: 'Test Issue', projectId: 'team-123' }, { toolCallId: 'test', messages: [] })
  })

  test('executes successfully with all params', async () => {
    setupCreateIssueMock()
    const tool = makeCreateIssueTool(mockApiKey, mockTeamId)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec(
      {
        title: 'Test Issue',
        description: 'Description',
        priority: 1,
        projectId: 'team-123',
        dueDate: '2025-03-15',
        labelIds: ['label-1'],
        estimate: 5,
      },
      { toolCallId: 'test', messages: [] },
    )
  })
})

describe('update_issue tool', () => {
  test('executes successfully', async () => {
    setupUpdateIssueMock()
    const tool = makeUpdateIssueTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec({ issueId: 'issue-123', status: 'In Progress' }, { toolCallId: 'test', messages: [] })
  })
})

describe('search_issues tool', () => {
  test('executes successfully', async () => {
    setupSearchIssuesMock()
    const tool = makeSearchIssuesTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    expect(
      Array.isArray(await exec({ query: 'test', projectId: 'project-123' }, { toolCallId: 'test', messages: [] })),
    ).toBe(true)
  })
})

describe('list_projects tool', () => {
  test('executes successfully', () => {
    setupListProjectsMock()
    const tool = makeListProjectsTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    exec({}, { toolCallId: 'test', messages: [] })
  })
})

describe('add_issue_comment tool', () => {
  test('executes successfully', async () => {
    setupAddIssueCommentMock()
    const tool = makeAddIssueCommentTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec(
      { issueId: 'issue-123', projectId: 'project-123', body: 'Test comment' },
      { toolCallId: 'test', messages: [] },
    )
  })
})

describe('get_issue_comments tool', () => {
  test('executes successfully', async () => {
    setupGetIssueCommentsMock()
    const tool = makeGetIssueCommentsTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    expect(Array.isArray(await exec({ issueId: 'issue-123' }, { toolCallId: 'test', messages: [] }))).toBe(true)
  })
})

describe('list_labels tool', () => {
  test('executes successfully', async () => {
    setupListLabelsMock()
    const tool = makeListLabelsTool(mockApiKey, mockTeamId)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    expect(Array.isArray(await exec({}, { toolCallId: 'test', messages: [] }))).toBe(true)
  })
})

describe('add_issue_relation tool', () => {
  test('executes successfully', async () => {
    setupAddIssueRelationMock()
    const tool = makeAddIssueRelationTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec(
      { issueId: 'issue-123', relatedIssueId: 'issue-456', type: 'blocks' },
      { toolCallId: 'test', messages: [] },
    )
  })
})

describe('get_issue tool', () => {
  test('executes successfully', async () => {
    setupGetIssueMock()
    const tool = makeGetIssueTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec({ issueId: 'issue-123' }, { toolCallId: 'test', messages: [] })
  })
})

describe('create_label tool', () => {
  test('executes successfully', async () => {
    setupCreateLabelMock()
    const tool = makeCreateLabelTool(mockApiKey, mockTeamId)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec({ name: 'Test Label' }, { toolCallId: 'test', messages: [] })
  })
})

describe('create_project tool', () => {
  test('executes successfully', async () => {
    setupCreateProjectMock()
    const tool = makeCreateProjectTool(mockApiKey, mockTeamId)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec({ name: 'Test Project' }, { toolCallId: 'test', messages: [] })
  })
})

describe('remove_issue_label tool', () => {
  test('executes successfully', async () => {
    setupRemoveIssueLabelMock()
    const tool = makeRemoveIssueLabelTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec(
      { issueId: 'issue-123', projectId: 'project-123', labelId: 'label-456' },
      { toolCallId: 'test', messages: [] },
    )
  })
})

describe('archive_issue tool', () => {
  test('executes successfully', async () => {
    setupArchiveIssueMock()
    const tool = makeArchiveIssueTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec({ issueId: 'issue-123' }, { toolCallId: 'test', messages: [] })
  })
})

describe('add_issue_label tool', () => {
  test('executes successfully', async () => {
    setupAddIssueLabelMock()
    const tool = makeAddIssueLabelTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec(
      { issueId: 'issue-123', projectId: 'project-123', labelId: 'label-456' },
      { toolCallId: 'test', messages: [] },
    )
  })
})

describe('archive_project tool', () => {
  test('executes successfully', async () => {
    setupArchiveProjectMock()
    const tool = makeArchiveProjectTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec({ projectId: 'project-123' }, { toolCallId: 'test', messages: [] })
  })
})

describe('remove_issue_comment tool', () => {
  test('executes successfully', async () => {
    setupRemoveIssueCommentMock()
    const tool = makeRemoveIssueCommentTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec(
      { commentId: 'comment-123', issueId: 'issue-123', projectId: 'project-123' },
      { toolCallId: 'test', messages: [] },
    )
  })
})

describe('remove_issue_relation tool', () => {
  test('executes successfully', async () => {
    setupRemoveIssueRelationMock()
    const tool = makeRemoveIssueRelationTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec({ issueId: 'issue-123', relatedIssueId: 'issue-456' }, { toolCallId: 'test', messages: [] })
  })
})

describe('remove_label tool', () => {
  test('executes successfully', async () => {
    setupRemoveLabelMock()
    const tool = makeRemoveLabelTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec({ labelId: 'label-123' }, { toolCallId: 'test', messages: [] })
  })
})

describe('update_issue_comment tool', () => {
  test('executes successfully', async () => {
    setupUpdateIssueCommentMock()
    const tool = makeUpdateIssueCommentTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec(
      { commentId: 'comment-123', body: 'Updated comment', issueId: 'issue-123', projectId: 'project-123' },
      { toolCallId: 'test', messages: [] },
    )
  })
})

describe('update_issue_relation tool', () => {
  test('executes successfully', async () => {
    setupUpdateIssueRelationMock()
    const tool = makeUpdateIssueRelationTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec(
      { issueId: 'issue-123', relatedIssueId: 'issue-456', type: 'related' },
      { toolCallId: 'test', messages: [] },
    )
  })
})

describe('update_label tool', () => {
  test('executes successfully', async () => {
    setupUpdateLabelMock()
    const tool = makeUpdateLabelTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec({ labelId: 'label-123', name: 'Updated Label' }, { toolCallId: 'test', messages: [] })
  })
})

describe('update_project tool', () => {
  test('executes successfully', async () => {
    setupUpdateProjectMock()
    const tool = makeUpdateProjectTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec({ projectId: 'project-123', name: 'Updated Project' }, { toolCallId: 'test', messages: [] })
  })
})
