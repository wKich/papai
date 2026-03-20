#!/usr/bin/env node
// PostToolUse — record when a test file is written this session

import fs from 'fs'
import path from 'path'

const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
const { tool_name, tool_input, session_id } = input

const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit']
const TEST_PATTERN = /(\.(test|spec)\.(ts|js|tsx|jsx|py)|_test\.go|_test\.rs)$/

if (!WRITE_TOOLS.includes(tool_name)) process.exit(0)

const filePath = tool_input.file_path ?? tool_input.path ?? tool_input.target_file
if (!filePath || !TEST_PATTERN.test(filePath)) process.exit(0)

const STATE_FILE = `/tmp/tdd-session-${session_id}.json`
let state = { writtenTests: [] }
try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
} catch {}

state.writtenTests.push(path.resolve(filePath))
fs.writeFileSync(STATE_FILE, JSON.stringify(state))

process.exit(0)
