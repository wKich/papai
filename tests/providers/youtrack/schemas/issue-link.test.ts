// tests/providers/youtrack/schemas/issue-link.test.ts
import { describe, expect, test } from "bun:test"
import {
  IssueLinkSchema,
  CreateIssueLinkRequestSchema,
  RemoveIssueLinkRequestSchema,
} from "../../../../src/providers/youtrack/schemas/issue-link.js"

describe("Issue link schemas", () => {
  test("IssueLinkSchema validates link", () => {
    const valid = {
      id: "0-0",
      $type: "IssueLink",
      type: {
        id: "0-0",
        $type: "IssueLinkType",
        name: "Relates",
        directed: false,
      },
      issues: [
        {
          id: "0-0",
          $type: "Issue",
          idReadable: "PROJ-456",
          summary: "Related issue",
          project: { id: "0-0", $type: "Project" },
          created: 1234567890,
          updated: 1234567890,
          customFields: [],
        },
      ],
    }
    const result = IssueLinkSchema.parse(valid)
    expect(result.type.name).toBe("Relates")
  })

  test("CreateIssueLinkRequestSchema validates request", () => {
    const valid = {
      path: { issueId: "PROJ-123" },
      body: {
        type: "Relates",
        issues: [{ idReadable: "PROJ-456" }],
      },
    }
    const result = CreateIssueLinkRequestSchema.parse(valid)
    expect(result.body.type).toBe("Relates")
  })

  test("RemoveIssueLinkRequestSchema validates request", () => {
    const valid = {
      path: { issueId: "PROJ-123", linkId: "0-0" },
    }
    const result = RemoveIssueLinkRequestSchema.parse(valid)
    expect(result.path.issueId).toBe("PROJ-123")
  })
})
