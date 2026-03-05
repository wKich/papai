import { describe, expect, test } from 'bun:test'

import { setupAddCommentMock } from '../linear/__mocks__/add-comment.js'
import { setupArchiveIssueMock } from '../linear/__mocks__/archive-issue.js'
import { setupCreateIssueMock } from '../linear/__mocks__/create-issue.js'
import { setupCreateLabelMock } from '../linear/__mocks__/create-label.js'
import { setupCreateProjectMock } from '../linear/__mocks__/create-project.js'
import { setupCreateRelationMock } from '../linear/__mocks__/create-relation.js'
import { setupGetCommentsMock } from '../linear/__mocks__/get-comments.js'
import { setupGetIssueLabelsMock } from '../linear/__mocks__/get-issue-labels.js'
import { setupGetIssueMock } from '../linear/__mocks__/get-issue.js'
import { setupGetRelationsMock } from '../linear/__mocks__/get-relations.js'
import { setupListLabelsMock } from '../linear/__mocks__/list-labels.js'
import { setupListProjectsMock } from '../linear/__mocks__/list-projects.js'
import { setupRemoveIssueLabelMock } from '../linear/__mocks__/remove-issue-label.js'
import { setupSearchIssuesMock } from '../linear/__mocks__/search-issues.js'
import { setupUpdateIssueMock } from '../linear/__mocks__/update-issue.js'
import { makeAddCommentTool } from './add-comment.js'
import { makeArchiveIssueTool } from './archive-issue.js'
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
    await exec({ title: 'Test Issue' }, { toolCallId: 'test', messages: [] })
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
    expect(Array.isArray(await exec({ query: 'test' }, { toolCallId: 'test', messages: [] }))).toBe(true)
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

describe('add_comment tool', () => {
  test('executes successfully', async () => {
    setupAddCommentMock()
    const tool = makeAddCommentTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    await exec({ issueId: 'issue-123', body: 'Test comment' }, { toolCallId: 'test', messages: [] })
  })
})

describe('get_comments tool', () => {
  test('executes successfully', async () => {
    setupGetCommentsMock()
    const tool = makeGetCommentsTool(mockApiKey)
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

describe('get_issue_labels tool', () => {
  test('executes successfully', async () => {
    setupGetIssueLabelsMock()
    const tool = makeGetIssueLabelsTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    expect(Array.isArray(await exec({ issueId: 'issue-123' }, { toolCallId: 'test', messages: [] }))).toBe(true)
  })
})

describe('create_relation tool', () => {
  test('executes successfully', async () => {
    setupCreateRelationMock()
    const tool = makeCreateRelationTool(mockApiKey)
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

describe('get_relations tool', () => {
  test('executes successfully', async () => {
    setupGetRelationsMock()
    const tool = makeGetRelationsTool(mockApiKey)
    if (tool.execute === undefined) {
      throw new Error('Tool execute not defined')
    }
    const exec = tool.execute
    expect(Array.isArray(await exec({ issueId: 'issue-123' }, { toolCallId: 'test', messages: [] }))).toBe(true)
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
    await exec({ issueId: 'issue-123', labelId: 'label-456' }, { toolCallId: 'test', messages: [] })
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
