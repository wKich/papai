#!/bin/sh
# Stop hook: fail if any modified .ts/.js file contains lint/type suppression comments.
files=$(git diff --name-only HEAD 2>/dev/null | grep -E '\.(ts|js)$')
[ -z "$files" ] && exit 0
if echo "$files" | xargs grep -l 'eslint-disable\|@ts-ignore\|@ts-nocheck\|oxlint-disable' 2>/dev/null; then
  echo 'ERROR: Lint/type suppression comments found in modified files. Remove them and fix the underlying issues instead.' >&2
  exit 1
fi
