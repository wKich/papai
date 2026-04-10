import type { ToolSet } from 'ai'

import type { TaskProvider } from '../providers/types.js'
import { makeAddCommentReactionTool } from './add-comment-reaction.js'
import { makeAddCommentTool } from './add-comment.js'
import { makeAddProjectMemberTool } from './add-project-member.js'
import { makeAddTaskLabelTool } from './add-task-label.js'
import { makeAddTaskRelationTool } from './add-task-relation.js'
import { makeAddVoteTool } from './add-vote.js'
import { makeAddWatcherTool } from './add-watcher.js'
import { makeArchiveMemosTool } from './archive-memos.js'
import { makeCancelDeferredPromptTool } from './cancel-deferred-prompt.js'
import { completionHook } from './completion-hook.js'
import { makeCountTasksTool } from './count-tasks.js'
import { makeCreateDeferredPromptTool } from './create-deferred-prompt.js'
import { makeCreateLabelTool } from './create-label.js'
import { makeCreateProjectTool } from './create-project.js'
import { makeCreateRecurringTaskTool } from './create-recurring-task.js'
import { makeCreateStatusTool } from './create-status.js'
import { makeCreateTaskTool } from './create-task.js'
import { makeDeleteProjectTool } from './delete-project.js'
import { makeDeleteRecurringTaskTool } from './delete-recurring-task.js'
import { makeDeleteStatusTool } from './delete-status.js'
import { makeDeleteTaskTool } from './delete-task.js'
import { makeFindUserTool } from './find-user.js'
import { makeGetCommentsTool } from './get-comments.js'
import { makeGetCurrentTimeTool } from './get-current-time.js'
import { makeGetDeferredPromptTool } from './get-deferred-prompt.js'
import { makeGetTaskTool } from './get-task.js'
import { makeDeleteInstructionTool, makeListInstructionsTool, makeSaveInstructionTool } from './instructions.js'
import { makeListAttachmentsTool } from './list-attachments.js'
import { makeListDeferredPromptsTool } from './list-deferred-prompts.js'
import { makeListLabelsTool } from './list-labels.js'
import { makeListMemosTool } from './list-memos.js'
import { makeListProjectTeamTool } from './list-project-team.js'
import { makeListProjectsTool } from './list-projects.js'
import { makeListRecurringTasksTool } from './list-recurring-tasks.js'
import { makeListStatusesTool } from './list-statuses.js'
import { makeListTasksTool } from './list-tasks.js'
import { makeListWatchersTool } from './list-watchers.js'
import { makeListWorkTool } from './list-work.js'
import { makeLogWorkTool } from './log-work.js'
import { makeLookupGroupHistoryTool } from './lookup-group-history.js'
import { makePauseRecurringTaskTool } from './pause-recurring-task.js'
import { makePromoteMemoTool } from './promote-memo.js'
import { makeRemoveAttachmentTool } from './remove-attachment.js'
import { makeRemoveCommentReactionTool } from './remove-comment-reaction.js'
import { makeRemoveCommentTool } from './remove-comment.js'
import { makeRemoveLabelTool } from './remove-label.js'
import { makeRemoveProjectMemberTool } from './remove-project-member.js'
import { makeRemoveTaskLabelTool } from './remove-task-label.js'
import { makeRemoveTaskRelationTool } from './remove-task-relation.js'
import { makeRemoveVoteTool } from './remove-vote.js'
import { makeRemoveWatcherTool } from './remove-watcher.js'
import { makeRemoveWorkTool } from './remove-work.js'
import { makeReorderStatusesTool } from './reorder-statuses.js'
import { makeResumeRecurringTaskTool } from './resume-recurring-task.js'
import { makeSaveMemoTool } from './save-memo.js'
import { makeSearchMemosTool } from './search-memos.js'
import { makeSearchTasksTool } from './search-tasks.js'
import { makeSetVisibilityTool } from './set-visibility.js'
import { makeSkipRecurringTaskTool } from './skip-recurring-task.js'
import { makeUpdateCommentTool } from './update-comment.js'
import { makeUpdateDeferredPromptTool } from './update-deferred-prompt.js'
import { makeUpdateLabelTool } from './update-label.js'
import { makeUpdateProjectTool } from './update-project.js'
import { makeUpdateRecurringTaskTool } from './update-recurring-task.js'
import { makeUpdateStatusTool } from './update-status.js'
import { makeUpdateTaskRelationTool } from './update-task-relation.js'
import { makeUpdateTaskTool } from './update-task.js'
import { makeUpdateWorkTool } from './update-work.js'
import { makeUploadAttachmentTool } from './upload-attachment.js'

export type ToolMode = 'normal' | 'proactive'

function makeCoreTools(provider: TaskProvider, userId?: string): ToolSet {
  return {
    create_task: makeCreateTaskTool(provider, userId),
    update_task: makeUpdateTaskTool(provider, completionHook, userId),
    search_tasks: makeSearchTasksTool(provider),
    list_tasks: makeListTasksTool(provider, userId),
    get_task: makeGetTaskTool(provider, userId),
    get_current_time: makeGetCurrentTimeTool(userId),
  }
}

function maybeAddProjectTools(tools: ToolSet, provider: TaskProvider): void {
  // Check each project capability individually
  if (provider.capabilities.has('projects.list')) {
    tools['list_projects'] = makeListProjectsTool(provider)
  }
  if (provider.capabilities.has('projects.create')) {
    tools['create_project'] = makeCreateProjectTool(provider)
  }
  if (provider.capabilities.has('projects.update')) {
    tools['update_project'] = makeUpdateProjectTool(provider)
  }
  if (provider.capabilities.has('projects.delete')) {
    tools['delete_project'] = makeDeleteProjectTool(provider)
  }
  if (provider.capabilities.has('projects.team')) {
    tools['list_project_team'] = makeListProjectTeamTool(provider)
    tools['add_project_member'] = makeAddProjectMemberTool(provider)
    tools['remove_project_member'] = makeRemoveProjectMemberTool(provider)
  }
}

function maybeAddCommentTools(tools: ToolSet, provider: TaskProvider): void {
  // Check each comment capability individually
  if (provider.capabilities.has('comments.read')) {
    tools['get_comments'] = makeGetCommentsTool(provider)
  }
  if (provider.capabilities.has('comments.create')) {
    tools['add_comment'] = makeAddCommentTool(provider)
  }
  if (provider.capabilities.has('comments.update')) {
    tools['update_comment'] = makeUpdateCommentTool(provider)
  }
  if (provider.capabilities.has('comments.delete')) {
    tools['remove_comment'] = makeRemoveCommentTool(provider)
  }
  if (provider.capabilities.has('comments.reactions')) {
    tools['add_comment_reaction'] = makeAddCommentReactionTool(provider)
    tools['remove_comment_reaction'] = makeRemoveCommentReactionTool(provider)
  }
}

function maybeAddLabelTools(tools: ToolSet, provider: TaskProvider): void {
  // Check each label capability individually
  if (provider.capabilities.has('labels.list')) {
    tools['list_labels'] = makeListLabelsTool(provider)
  }
  if (provider.capabilities.has('labels.create')) {
    tools['create_label'] = makeCreateLabelTool(provider)
  }
  if (provider.capabilities.has('labels.update')) {
    tools['update_label'] = makeUpdateLabelTool(provider)
  }
  if (provider.capabilities.has('labels.delete')) {
    tools['remove_label'] = makeRemoveLabelTool(provider)
  }
  if (provider.capabilities.has('labels.assign')) {
    tools['add_task_label'] = makeAddTaskLabelTool(provider)
    tools['remove_task_label'] = makeRemoveTaskLabelTool(provider)
  }
}

function maybeAddRelationTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('tasks.relations')) {
    tools['add_task_relation'] = makeAddTaskRelationTool(provider)
    tools['update_task_relation'] = makeUpdateTaskRelationTool(provider)
    tools['remove_task_relation'] = makeRemoveTaskRelationTool(provider)
  }
}

function maybeAddStatusTools(tools: ToolSet, provider: TaskProvider): void {
  // Check each status capability individually
  if (provider.capabilities.has('statuses.list')) {
    tools['list_statuses'] = makeListStatusesTool(provider)
  }
  if (provider.capabilities.has('statuses.create')) {
    tools['create_status'] = makeCreateStatusTool(provider)
  }
  if (provider.capabilities.has('statuses.update')) {
    tools['update_status'] = makeUpdateStatusTool(provider)
  }
  if (provider.capabilities.has('statuses.delete')) {
    tools['delete_status'] = makeDeleteStatusTool(provider)
  }
  if (provider.capabilities.has('statuses.reorder')) {
    tools['reorder_statuses'] = makeReorderStatusesTool(provider)
  }
}

function maybeAddAttachmentTools(tools: ToolSet, provider: TaskProvider, contextId: string | undefined): void {
  if (contextId === undefined) return
  if (provider.capabilities.has('attachments.list')) {
    tools['list_attachments'] = makeListAttachmentsTool(provider)
  }
  if (provider.capabilities.has('attachments.upload')) {
    tools['upload_attachment'] = makeUploadAttachmentTool(provider, contextId)
  }
  if (provider.capabilities.has('attachments.delete')) {
    tools['remove_attachment'] = makeRemoveAttachmentTool(provider)
  }
}

function maybeAddWorkItemTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('workItems.list')) {
    tools['list_work'] = makeListWorkTool(provider)
  }
  if (provider.capabilities.has('workItems.create')) {
    tools['log_work'] = makeLogWorkTool(provider)
  }
  if (provider.capabilities.has('workItems.update')) {
    tools['update_work'] = makeUpdateWorkTool(provider)
  }
  if (provider.capabilities.has('workItems.delete')) {
    tools['remove_work'] = makeRemoveWorkTool(provider)
  }
}

function maybeAddCountTasksTool(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('tasks.count') && provider.countTasks !== undefined) {
    tools['count_tasks'] = makeCountTasksTool(provider)
  }
}

function maybeAddDeleteTool(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('tasks.delete')) {
    tools['delete_task'] = makeDeleteTaskTool(provider)
  }
}

function maybeAddCollaborationTaskTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.listUsers !== undefined) {
    tools['find_user'] = makeFindUserTool(provider)
  }
  if (provider.capabilities.has('tasks.watchers')) {
    tools['list_watchers'] = makeListWatchersTool(provider)
    tools['add_watcher'] = makeAddWatcherTool(provider)
    tools['remove_watcher'] = makeRemoveWatcherTool(provider)
  }
  if (provider.capabilities.has('tasks.votes')) {
    tools['add_vote'] = makeAddVoteTool(provider)
    tools['remove_vote'] = makeRemoveVoteTool(provider)
  }
  if (provider.capabilities.has('tasks.visibility')) {
    tools['set_visibility'] = makeSetVisibilityTool(provider)
  }
}

function addInstructionTools(tools: ToolSet, contextId: string | undefined): void {
  if (contextId === undefined) return
  tools['save_instruction'] = makeSaveInstructionTool(contextId)
  tools['list_instructions'] = makeListInstructionsTool(contextId)
  tools['delete_instruction'] = makeDeleteInstructionTool(contextId)
}

function addMemoTools(tools: ToolSet, provider: TaskProvider, userId: string | undefined): void {
  if (userId === undefined) return
  tools['save_memo'] = makeSaveMemoTool(userId)
  tools['search_memos'] = makeSearchMemosTool(userId)
  tools['list_memos'] = makeListMemosTool(userId)
  tools['archive_memos'] = makeArchiveMemosTool(userId)
  tools['promote_memo'] = makePromoteMemoTool(provider, userId)
}

function addRecurringTools(tools: ToolSet, userId: string | undefined): void {
  if (userId === undefined) return
  tools['create_recurring_task'] = makeCreateRecurringTaskTool(userId)
  tools['list_recurring_tasks'] = makeListRecurringTasksTool(userId)
  tools['update_recurring_task'] = makeUpdateRecurringTaskTool()
  tools['pause_recurring_task'] = makePauseRecurringTaskTool()
  tools['resume_recurring_task'] = makeResumeRecurringTaskTool()
  tools['skip_recurring_task'] = makeSkipRecurringTaskTool()
  tools['delete_recurring_task'] = makeDeleteRecurringTaskTool()
}

function addDeferredPromptTools(tools: ToolSet, userId: string | undefined): void {
  if (userId === undefined) return
  tools['create_deferred_prompt'] = makeCreateDeferredPromptTool(userId)
  tools['list_deferred_prompts'] = makeListDeferredPromptsTool(userId)
  tools['get_deferred_prompt'] = makeGetDeferredPromptTool(userId)
  tools['update_deferred_prompt'] = makeUpdateDeferredPromptTool(userId)
  tools['cancel_deferred_prompt'] = makeCancelDeferredPromptTool(userId)
}

function addLookupGroupHistoryTool(tools: ToolSet, userId: string | undefined, contextId: string | undefined): void {
  if (userId === undefined || contextId === undefined) return
  tools['lookup_group_history'] = makeLookupGroupHistoryTool(userId, contextId)
}

export function makeTools(
  provider: TaskProvider,
  userId?: string,
  mode: ToolMode = 'normal',
  contextId?: string,
): ToolSet {
  const tools = makeCoreTools(provider, userId)
  maybeAddProjectTools(tools, provider)
  maybeAddCommentTools(tools, provider)
  maybeAddLabelTools(tools, provider)
  maybeAddRelationTools(tools, provider)
  maybeAddStatusTools(tools, provider)
  maybeAddDeleteTool(tools, provider)
  maybeAddCollaborationTaskTools(tools, provider)
  maybeAddAttachmentTools(tools, provider, userId)
  maybeAddWorkItemTools(tools, provider)
  maybeAddCountTasksTool(tools, provider)
  addRecurringTools(tools, userId)
  addMemoTools(tools, provider, userId)
  addInstructionTools(tools, userId)
  addLookupGroupHistoryTool(tools, userId, contextId)
  if (mode === 'normal') {
    addDeferredPromptTools(tools, userId)
  }
  return tools
}
