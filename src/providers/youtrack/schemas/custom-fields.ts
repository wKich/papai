// src/providers/youtrack/schemas/custom-fields.ts
import { z } from 'zod'

import { UserReferenceSchema } from './user.js'

const EnumBundleElementSchema = z.object({
  $type: z.literal('EnumBundleElement'),
  name: z.string(),
  ordinal: z.number().optional(),
})

const TextFieldValueSchema = z.object({
  $type: z.literal('TextFieldValue'),
  text: z.string(),
})

export const SingleEnumIssueCustomFieldSchema = z.object({
  $type: z.literal('SingleEnumIssueCustomField'),
  name: z.string(),
  value: EnumBundleElementSchema,
})

export const SingleUserIssueCustomFieldSchema = z.object({
  $type: z.literal('SingleUserIssueCustomField'),
  name: z.string(),
  value: UserReferenceSchema.optional(),
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
  z.object({
    $type: z.literal('MultiEnumIssueCustomField'),
    name: z.string(),
    value: z.array(EnumBundleElementSchema),
  }),
  SingleUserIssueCustomFieldSchema,
  z.object({
    $type: z.literal('MultiUserIssueCustomField'),
    name: z.string(),
    value: z.array(UserReferenceSchema).optional(),
  }),
  TextIssueCustomFieldSchema,
  SimpleIssueCustomFieldSchema,
])
