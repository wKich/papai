// src/providers/youtrack/schemas/custom-fields.ts
import { z } from 'zod'

import { UserReferenceSchema } from './user.js'

export const EnumBundleElementSchema = z.object({
  $type: z.literal('EnumBundleElement'),
  name: z.string(),
  ordinal: z.number().optional(),
})

export const TextFieldValueSchema = z.object({
  $type: z.literal('TextFieldValue'),
  text: z.string(),
})

export const SingleEnumIssueCustomFieldSchema = z.object({
  $type: z.literal('SingleEnumIssueCustomField'),
  name: z.string(),
  value: EnumBundleElementSchema,
})

export const MultiEnumIssueCustomFieldSchema = z.object({
  $type: z.literal('MultiEnumIssueCustomField'),
  name: z.string(),
  value: z.array(EnumBundleElementSchema),
})

export const SingleUserIssueCustomFieldSchema = z.object({
  $type: z.literal('SingleUserIssueCustomField'),
  name: z.string(),
  value: UserReferenceSchema.optional(),
})

export const MultiUserIssueCustomFieldSchema = z.object({
  $type: z.literal('MultiUserIssueCustomField'),
  name: z.string(),
  value: z.array(UserReferenceSchema).optional(),
})

export const TextIssueCustomFieldSchema = z.object({
  $type: z.literal('TextIssueCustomField'),
  name: z.string(),
  value: TextFieldValueSchema,
})

export const SimpleIssueCustomFieldSchema = z.object({
  $type: z.literal('SimpleIssueCustomField'),
  name: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
})

export const CustomFieldValueSchema = z.union([
  SingleEnumIssueCustomFieldSchema,
  MultiEnumIssueCustomFieldSchema,
  SingleUserIssueCustomFieldSchema,
  MultiUserIssueCustomFieldSchema,
  TextIssueCustomFieldSchema,
  SimpleIssueCustomFieldSchema,
])

export const ProjectCustomFieldSchema = z.object({
  $type: z.string(),
  name: z.string(),
  fieldType: z.object({
    $type: z.string(),
    id: z.string(),
  }),
})

export type EnumBundleElement = z.infer<typeof EnumBundleElementSchema>
export type TextFieldValue = z.infer<typeof TextFieldValueSchema>
export type SingleEnumIssueCustomField = z.infer<typeof SingleEnumIssueCustomFieldSchema>
export type MultiEnumIssueCustomField = z.infer<typeof MultiEnumIssueCustomFieldSchema>
export type SingleUserIssueCustomField = z.infer<typeof SingleUserIssueCustomFieldSchema>
export type MultiUserIssueCustomField = z.infer<typeof MultiUserIssueCustomFieldSchema>
export type TextIssueCustomField = z.infer<typeof TextIssueCustomFieldSchema>
export type SimpleIssueCustomField = z.infer<typeof SimpleIssueCustomFieldSchema>
export type CustomFieldValue = z.infer<typeof CustomFieldValueSchema>
export type ProjectCustomField = z.infer<typeof ProjectCustomFieldSchema>
