import { z } from 'zod'

export const MattermostWsEventSchema = z.object({
  event: z.string(),
  data: z.record(z.string(), z.unknown()),
})

export const MattermostPostedDataSchema = z.object({
  post: z.string(),
  sender_name: z.string().optional(),
})

export const MattermostPostSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  channel_id: z.string(),
  message: z.string(),
  user_name: z.string().optional(),
  root_id: z.string().optional(),
  parent_id: z.string().optional(),
  file_ids: z.array(z.string()).optional(),
})

export const MattermostFileInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  mime_type: z.string().optional(),
  size: z.number().optional(),
})

export const UserMeSchema = z.object({ id: z.string(), username: z.string().optional() })
export const ChannelSchema = z.object({ id: z.string() })
export const ChannelInfoSchema = z.object({ type: z.string() })
export const ChannelMemberSchema = z.object({ roles: z.string() })
export const FileUploadSchema = z.object({ file_infos: z.array(z.object({ id: z.string() })) })

export type MattermostPost = z.infer<typeof MattermostPostSchema>

export function extractReplyId(parentId?: string, rootId?: string): string | undefined {
  if (parentId !== undefined && parentId !== '') return parentId
  if (rootId !== undefined && rootId !== '') return rootId
  return undefined
}
